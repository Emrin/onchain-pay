import { Module } from '@nestjs/common';
import { ChainModule } from '../chain/chain.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';

@Module({
  imports: [PrismaModule, ChainModule],
  providers: [DepositsService],
  controllers: [DepositsController],
})
export class DepositsModule {}
