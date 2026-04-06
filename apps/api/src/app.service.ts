import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis/redis.module';

@Injectable()
export class AppService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  getHello(): string {
    return 'Hello from NestJS!';
  }

  async healthCheck(): Promise<{ status: string }> {
    await this.redis.ping();
    return { status: 'ok' };
  }
}