import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const REDIS_KEY = 'prices:rates';
const TTL_SECONDS = 300; // 5-min safety TTL; cron refreshes every minute
const FALLBACK = { btcUsd: 97000, ltcUsd: 85 };

export interface Rates {
  btcUsd: number;
  ltcUsd: number;
  updatedAt: string | null;
}

@Injectable()
export class PricesService implements OnModuleInit {
  private readonly logger = new Logger(PricesService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.fetchAndCacheRates();
  }

  @Cron('* * * * *')
  async fetchAndCacheRates(): Promise<void> {
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,litecoin&vs_currencies=usd',
        { signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) {
        this.logger.warn(`CoinGecko returned ${res.status}`);
        return;
      }
      const data = (await res.json()) as {
        bitcoin?: { usd?: number };
        litecoin?: { usd?: number };
      };
      const rates: Rates = {
        btcUsd: data.bitcoin?.usd ?? FALLBACK.btcUsd,
        ltcUsd: data.litecoin?.usd ?? FALLBACK.ltcUsd,
        updatedAt: new Date().toISOString(),
      };

      await Promise.all([
        this.redis.set(REDIS_KEY, JSON.stringify(rates), 'EX', TTL_SECONDS),
        this.persistRates(rates),
      ]);

      this.logger.debug(`Rates updated: BTC=$${rates.btcUsd} LTC=$${rates.ltcUsd}`);
    } catch (err) {
      this.logger.warn(`Failed to fetch rates: ${(err as Error).message}`);
    }
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
        where: { pair: { in: ['BTC_USD', 'LTC_USD'] } },
      });
      const btc = rows.find((r) => r.pair === 'BTC_USD');
      const ltc = rows.find((r) => r.pair === 'LTC_USD');
      if (btc && ltc) {
        this.logger.warn('Serving rates from Postgres fallback');
        return {
          btcUsd: btc.rate,
          ltcUsd: ltc.rate,
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
