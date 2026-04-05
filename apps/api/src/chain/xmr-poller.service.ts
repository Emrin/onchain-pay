import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { XmrRpcError, XmrWalletService, XMR_ERR_NO_DAEMON } from './xmr-wallet.service';

const XMR_CONFIRMATIONS_REQUIRED = 10;
const POLL_INTERVAL_MS = 30_000;

@Injectable()
export class XmrPollerService implements OnModuleInit {
  private readonly logger = new Logger(XmrPollerService.name);

  constructor(
    private readonly xmrWallet: XmrWalletService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    void this.pollLoop();
  }

  private async pollLoop(): Promise<void> {
    while (true) {
      try {
        await this.poll();
      } catch (err) {
        this.logger.error(`XMR poll error: ${(err as Error).message}`);
        if (err instanceof XmrRpcError && err.code === XMR_ERR_NO_DAEMON) {
          await this.xmrWallet.rotateDaemon();
        }
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  private async poll(): Promise<void> {
    const transfers = await this.xmrWallet.getTransfers();

    for (const transfer of transfers) {
      const pending = await this.prisma.transaction.findFirst({
        where: { address: transfer.address, currency: 'XMR', status: 'pending' },
      });
      if (!pending) continue;

      // Ignore additional transfers to the same subaddress while an invoice is pending.
      // Only the first transaction is tracked — same policy as BTC/LTC.
      if (pending.txid && pending.txid !== transfer.txid) {
        this.logger.warn(
          `XMR invoice ${pending.invoiceId}: ignoring extra transfer ${transfer.txid} (already tracking ${pending.txid})`,
        );
        continue;
      }

      if (transfer.confirmations < XMR_CONFIRMATIONS_REQUIRED) {
        // Update confirmation count and record actual received amount for progress display.
        await this.prisma.transaction.update({
          where: { id: pending.id },
          data: {
            confirmations: transfer.confirmations,
            txid: transfer.txid,
            receivedSats: transfer.amount,
          },
        });
        this.logger.log(
          `XMR tx ${transfer.txid} has ${transfer.confirmations}/${XMR_CONFIRMATIONS_REQUIRED} confirmations`,
        );
        continue;
      }

      const status = transfer.amount >= pending.amountSats ? 'settled' : 'underpaid';

      const updated = await this.prisma.transaction.updateMany({
        where: { id: pending.id, status: 'pending' },
        data: {
          status,
          receivedSats: transfer.amount,
          txid: transfer.txid,
          confirmations: transfer.confirmations,
        },
      });

      if (updated.count === 0) continue;

      await this.prisma.user.update({
        where: { id: pending.userId },
        data: { balancePiconero: { increment: transfer.amount } },
      });

      if (status === 'underpaid') {
        this.logger.warn(
          `XMR invoice ${pending.invoiceId}: underpaid — ` +
          `received ${transfer.amount}, invoiced ${pending.amountSats}. ` +
          `Credited received amount to user ${pending.userId}.`,
        );
      } else {
        this.logger.log(
          `Settled XMR tx ${transfer.txid}: credited ${transfer.amount} piconero to user ${pending.userId}`,
        );
      }
    }
  }
}
