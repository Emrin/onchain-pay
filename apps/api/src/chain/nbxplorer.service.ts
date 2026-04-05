import { Injectable, Logger } from '@nestjs/common';

export interface NbxplorerEvent {
  eventId: number;
  // NBXplorer 2.x uses lowercase type strings
  type: 'newtransaction' | 'newblock';
  data: {
    trackedSource?: string;
    cryptoCode?: string;
    // newtransaction: details live in transactionData + outputs (not transaction)
    transactionData?: {
      transactionHash: string;
      confirmations?: number;
      height?: number | null;
    };
    outputs?: Array<{ address?: string; value?: number }>;
    // newblock fields
    hash?: string;
    height?: number;
  };
}

@Injectable()
export class NbxplorerService {
  private readonly logger = new Logger(NbxplorerService.name);
  private readonly baseUrl = process.env.NBXPLORER_URL || 'http://nbxplorer:32838';

  cryptoCode(currency: string): string {
    return currency.toLowerCase();
  }

  async getStatus(currency: string): Promise<{ isFullySynched: boolean }> {
    const res = await fetch(
      `${this.baseUrl}/v1/cryptos/${this.cryptoCode(currency)}/status`,
    );
    if (!res.ok) throw new Error(`NBXplorer status failed: ${res.status}`);
    return res.json() as Promise<{ isFullySynched: boolean }>;
  }

  async trackAddress(currency: string, address: string): Promise<void> {
    // NBXplorer tracks a standalone address at POST /addresses/{address}
    // (address in the path, no body).  /addresses/track was wrong: "track"
    // was being parsed as a Bitcoin address → invalid-format.
    const res = await fetch(
      `${this.baseUrl}/v1/cryptos/${this.cryptoCode(currency)}/addresses/${address}`,
      { method: 'POST' },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`NBXplorer trackAddress failed for ${address} (HTTP ${res.status}): ${text}`);
    }
    this.logger.log(`Tracking ${currency} address ${address}`);
  }

  /** Long-poll for new events. Returns immediately if events exist, else blocks up to ~30s. */
  async longPollEvents(
    currency: string,
    lastSeenEventId: number,
  ): Promise<NbxplorerEvent[]> {
    const url = `${this.baseUrl}/v1/cryptos/${this.cryptoCode(currency)}/events?lastEventId=${lastSeenEventId}&longPolling=true`;
    // 35 s: NBXplorer returns empty within 30 s when idle; shorter than Docker
    // Desktop's ~60 s idle-connection drop which would silently hang the fetch.
    const res = await fetch(url, { signal: AbortSignal.timeout(35_000) });
    if (!res.ok) throw new Error(`NBXplorer longPoll failed: ${res.status}`);
    return res.json() as Promise<NbxplorerEvent[]>;
  }
}
