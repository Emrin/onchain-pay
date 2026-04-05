import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AddressDerivationService } from './address-derivation.service';
import { ExpirySchedulerService } from './expiry-scheduler.service';
import { NbxplorerPollerService } from './nbxplorer-poller.service';
import { NbxplorerService } from './nbxplorer.service';
import { XmrPollerService } from './xmr-poller.service';
import { XmrWalletService } from './xmr-wallet.service';

@Module({
  imports: [PrismaModule],
  providers: [
    AddressDerivationService,
    NbxplorerService,
    NbxplorerPollerService,
    XmrWalletService,
    XmrPollerService,
    ExpirySchedulerService,
  ],
  exports: [AddressDerivationService, NbxplorerService, XmrWalletService],
})
export class ChainModule {}
