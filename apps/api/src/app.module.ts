import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { DepositsModule } from './deposits/deposits.module';
import { PricesModule } from './prices/prices.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      // Baseline: protects every endpoint from burst abuse
      { name: 'global', ttl: 60_000, limit: 120 },
      // Strict: applied only to AuthController to prevent brute-force
      { name: 'auth', ttl: 900_000, limit: 10 },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    UsersModule,
    AuthModule,
    DepositsModule,
    PricesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
