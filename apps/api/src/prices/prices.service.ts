import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { fetch, ProxyAgent } from 'undici';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const REDIS_KEY = 'prices:rates';
const FALLBACK = { btcUsd: 97000, ltcUsd: 85, xmrUsd: 160 };

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,litecoin,monero&vs_currencies=usd';
const FETCH_TIMEOUT_MS = 15_000; // Tor adds latency vs. clearnet
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 10_000;

export interface Rates {
  btcUsd: number;
  ltcUsd: number;
  xmrUsd: number;
  updatedAt: string | null;
}

@Injectable()
export class PricesService implements OnModuleInit {
  private readonly logger = new Logger(PricesService.name);

  // Privoxy HTTP proxy that forwards to Tor SOCKS5.
  // Unset in local dev (TOR_HTTP_PROXY='') — falls back to direct clearnet fetch.
  private readonly dispatcher = process.env.TOR_HTTP_PROXY
    ? new ProxyAgent(process.env.TOR_HTTP_PROXY)
    : undefined;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.fetchAndCacheRates();
  }

  @Cron('* * * * *')
  async fetchAndCacheRates(): Promise<void> {
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      try {
        const rates = await this.fetchRates();
        await Promise.all([
          this.redis.set(REDIS_KEY, JSON.stringify(rates)),
          this.persistRates(rates),
        ]);
        this.logger.debug(
          `Rates updated: BTC=$${rates.btcUsd} LTC=$${rates.ltcUsd} XMR=$${rates.xmrUsd}`,
        );
        return;
      } catch (err) {
        const msg = (err as Error).message;
        if (attempt < RETRY_ATTEMPTS) {
          this.logger.warn(
            `Rates fetch attempt ${attempt}/${RETRY_ATTEMPTS} failed: ${msg} — retrying in ${RETRY_DELAY_MS / 1000}s`,
          );
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        } else {
          this.logger.warn(`Rates fetch failed after ${RETRY_ATTEMPTS} attempts: ${msg}`);
        }
      }
    }
    // Stale rates in Redis/Postgres remain valid until the next successful cron tick
  }

  private async fetchRates(): Promise<Rates> {
    const res = await fetch(COINGECKO_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
    });
    if (!res.ok) throw new Error(`CoinGecko returned ${res.status}`);
    const data = (await res.json()) as {
      bitcoin?: { usd?: number };
      litecoin?: { usd?: number };
      monero?: { usd?: number };
    };
    return {
      btcUsd: data.bitcoin?.usd ?? FALLBACK.btcUsd,
      ltcUsd: data.litecoin?.usd ?? FALLBACK.ltcUsd,
      xmrUsd: data.monero?.usd ?? FALLBACK.xmrUsd,
      updatedAt: new Date().toISOString(),
    };
  }

  private async persistRates(rates: Rates): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.exchangeRate.upsert({
        where: { pair: 'BTC_USD' },
        update: { rate: rates.btcUsd, updatedAt: now },
        create: { pair: 'BTC_USD', rate: rates.btcUsd, updatedAt: now },
      }),
      this.prisma.exchangeRate.upsert({
        where: { pair: 'LTC_USD' },
        update: { rate: rates.ltcUsd, updatedAt: now },
        create: { pair: 'LTC_USD', rate: rates.ltcUsd, updatedAt: now },
      }),
      this.prisma.exchangeRate.upsert({
        where: { pair: 'XMR_USD' },
        update: { rate: rates.xmrUsd, updatedAt: now },
        create: { pair: 'XMR_USD', rate: rates.xmrUsd, updatedAt: now },
      }),
    ]);
  }

  async getRates(): Promise<Rates> {
    // 1. Redis — fast, sub-millisecond
    try {
      const cached = await this.redis.get(REDIS_KEY);
      if (cached) return JSON.parse(cached) as Rates;
    } catch (err) {
      this.logger.warn(`Redis read failed: ${(err as Error).message}`);
    }

    // 2. Postgres — persistent, survives Redis restarts and extended CoinGecko outages
    try {
      const rows = await this.prisma.exchangeRate.findMany({
        where: { pair: { in: ['BTC_USD', 'LTC_USD', 'XMR_USD'] } },
      });
      const btc = rows.find((r) => r.pair === 'BTC_USD');
      const ltc = rows.find((r) => r.pair === 'LTC_USD');
      const xmr = rows.find((r) => r.pair === 'XMR_USD');
      if (btc && ltc && xmr) {
        this.logger.warn('Serving rates from Postgres fallback');
        return {
          btcUsd: btc.rate,
          ltcUsd: ltc.rate,
          xmrUsd: xmr.rate,
          updatedAt: btc.updatedAt.toISOString(),
        };
      }
    } catch (err) {
      this.logger.warn(`Postgres read failed: ${(err as Error).message}`);
    }

    // 3. Hardcoded constants — last resort
    this.logger.warn('Serving hardcoded fallback rates');
    return { ...FALLBACK, updatedAt: null };
  }
}
