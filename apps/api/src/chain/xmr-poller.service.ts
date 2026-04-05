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
      if (transfer.confirmations < XMR_CONFIRMATIONS_REQUIRED) continue;

      const pending = await this.prisma.transaction.findFirst({
        where: {
          address: transfer.address,
          currency: 'XMR',
          status: 'pending',
        },
      });
      if (!pending) continue;

      const updated = await this.prisma.transaction.updateMany({
        where: { id: pending.id, status: 'pending' },
        data: {
          status: 'settled',
          amountSats: transfer.amount,
          txid: transfer.txid,
          confirmations: transfer.confirmations,
        },
      });

      if (updated.count === 0) continue;

      await this.prisma.user.update({
        where: { id: pending.userId },
        data: { balancePiconero: { increment: transfer.amount } },
      });

      this.logger.log(
        `Settled XMR tx ${transfer.txid}: credited ${transfer.amount} piconero to user ${pending.userId}`,
      );
    }
  }
}
