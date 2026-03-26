import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
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
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    UsersModule,
    AuthModule,
    DepositsModule,
    PricesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}