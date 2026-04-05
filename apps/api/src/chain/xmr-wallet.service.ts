import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

export class XmrRpcError extends Error {
  constructor(public readonly code: number, message: string) {
    super(`XMR RPC error ${code}: ${message}`);
    this.name = 'XmrRpcError';
  }
}

// monero-wallet-rpc error code for "no connection to daemon"
export const XMR_ERR_NO_DAEMON = -9;

interface RpcResponse<T> {
  result: T;
  error?: { code: number; message: string };
}

@Injectable()
export class XmrWalletService implements OnModuleInit {
  private readonly logger = new Logger(XmrWalletService.name);
  private readonly rpcUrl =
    process.env.MONERO_WALLET_RPC_URL || 'http://xmr-wallet:18082/json_rpc';
  private readonly walletName =
    process.env.MONERO_WALLET_NAME || 'crypto-demo';

  // Comma-separated list of daemon addresses (onion or clearnet).
  // The wallet-rpc container starts with the first one via --daemon-address;
  // we rotate through the rest at runtime using set_daemon when -9 is returned.
  private readonly daemonNodes: string[] = (process.env.XMR_DAEMON_NODES || '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  private daemonIndex = 0;

  // Optional SOCKS5 proxy for Tor onion addresses, e.g. "tor-socks:9050"
  private readonly torProxy = process.env.XMR_TOR_PROXY || '';

  // False until wallet-rpc is reachable and a wallet is open. Allows lazy
  // re-init on first use when wallet-rpc starts slower than the API pod.
  private walletReady = false;

  async onModuleInit(): Promise<void> {
    try {
      await this.initWallet();
    } catch (err) {
      this.logger.warn(
        `XMR wallet unavailable at startup (${(err as Error).message}) — will retry on first use`,
      );
    }
  }

  /** Open (or create) the wallet and point it at the configured daemon. */
  private async initWallet(): Promise<void> {
    const primary = this.daemonNodes[0];
    if (primary) {
      try {
        await this.setDaemon(primary);
      } catch (err) {
        // Daemon may be temporarily unreachable; wallet-rpc already has
        // --daemon-address from its CLI args so the wallet can still be
        // opened — it will sync once the daemon becomes available.
        this.logger.warn(`set_daemon failed (${(err as Error).message}) — opening wallet with startup daemon`);
      }
    }
    try {
      await this.openWallet();
    } catch {
      this.logger.log('Wallet not found — creating a new one');
      await this.createWallet();
    }
    this.walletReady = true;
    this.logger.log('XMR wallet ready');
  }

  /** Ensures the wallet is open before any RPC call that requires it. */
  private async ensureWalletOpen(): Promise<void> {
    if (this.walletReady) return;
    await this.initWallet();
  }

  private async rpc<T>(method: string, params: object = {}): Promise<T> {
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: '0', method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`XMR RPC HTTP error: ${res.status}`);
    const body = (await res.json()) as RpcResponse<T>;
    if (body.error) {
      if (body.error.code === -13) this.walletReady = false; // wallet closed (pod restarted?)
      throw new XmrRpcError(body.error.code, body.error.message);
    }
    return body.result;
  }

  private async setDaemon(address: string): Promise<void> {
    const params: Record<string, unknown> = { address, trusted: false };
    if (this.torProxy) params.proxy = this.torProxy;
    await this.rpc('set_daemon', params);
    this.logger.log(`XMR daemon → ${address}`);
  }

  /** Rotate to the next daemon in the list. Called by the poller on error -9. */
  async rotateDaemon(): Promise<void> {
    if (this.daemonNodes.length <= 1) {
      this.logger.warn('XMR daemon unreachable and no fallback nodes configured');
      return;
    }
    this.daemonIndex = (this.daemonIndex + 1) % this.daemonNodes.length;
    const next = this.daemonNodes[this.daemonIndex];
    if (!next) return;
    this.logger.warn(`XMR daemon unreachable — rotating to ${next}`);
    this.walletReady = false;
    await this.setDaemon(next);
  }

  private async openWallet(): Promise<void> {
    await this.rpc('open_wallet', { filename: this.walletName });
    this.logger.log(`Opened wallet: ${this.walletName}`);
  }

  private async createWallet(): Promise<void> {
    await this.rpc('create_wallet', {
      filename: this.walletName,
      language: 'English',
    });
    this.logger.log(`Created wallet: ${this.walletName}`);
  }

  async createSubaddress(label: string): Promise<{ address: string; index: number }> {
    await this.ensureWalletOpen();
    const result = await this.rpc<{ address: string; address_index: number }>(
      'create_address',
      { account_index: 0, label },
    );
    return { address: result.address, index: result.address_index };
  }

  async getTransfers(): Promise<
    Array<{
      address: string;
      amount: bigint;
      txid: string;
      confirmations: number;
      subaddrIndex: number;
    }>
  > {
    await this.ensureWalletOpen();

    type XmrTransfer = {
      address: string;
      amount: number;
      txid: string;
      confirmations: number;
      subaddr_index: { minor: number };
    };

    // `in` = confirmed incoming; `pool` = unconfirmed incoming (mempool).
    // `pending` controls outgoing only — set false to avoid processing our own sends.
    const result = await this.rpc<{ in?: XmrTransfer[]; pool?: XmrTransfer[] }>(
      'get_transfers',
      { in: true, pool: true, pending: false },
    );

    return [...(result.in ?? []), ...(result.pool ?? [])].map((t) => ({
      address: t.address,
      amount: BigInt(t.amount),
      txid: t.txid,
      confirmations: t.confirmations,
      subaddrIndex: t.subaddr_index.minor,
    }));
  }
}
