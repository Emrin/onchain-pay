import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExpirySchedulerService {
  private readonly logger = new Logger(ExpirySchedulerService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireInvoices(): Promise<void> {
    const result = await this.prisma.transaction.updateMany({
      where: {
        status: 'pending',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'expired' },
    });

    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} invoice(s)`);
    }
  }
}
