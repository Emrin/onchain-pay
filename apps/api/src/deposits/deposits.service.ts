import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AddressDerivationService } from '../chain/address-derivation.service';
import { NbxplorerService } from '../chain/nbxplorer.service';
import { XmrWalletService } from '../chain/xmr-wallet.service';
import { PrismaService } from '../prisma/prisma.service';

const INVOICE_TTL_MS = parseInt(process.env.INVOICE_TTL_MS ?? '1800000', 10); // 30 min default

@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addressDerivation: AddressDerivationService,
    private readonly nbxplorer: NbxplorerService,
    private readonly xmrWallet: XmrWalletService,
  ) {}

  async createDeposit(
    userId: number,
    amountSats: number,
    currency: string,
  ): Promise<{
    invoiceId: string;
    amountSats: string;
    address: string;
    currency: string;
    status: string;
    expiresAt: string;
  }> {
    // Enforce 1 pending invoice per user per currency
    const existing = await this.prisma.transaction.findFirst({
      where: { userId, currency, status: 'pending', deletedAt: null },
    });
    if (existing) {
      throw new ConflictException({
        message: `You already have a pending ${currency} deposit`,
        invoiceId: existing.invoiceId,
        amountSats: existing.amountSats.toString(),
        address: existing.address,
        currency: existing.currency,
        expiresAt: existing.expiresAt?.toISOString(),
      });
    }

    const invoiceId = randomUUID();
    const expiresAt = new Date(Date.now() + INVOICE_TTL_MS);
    let address: string;

    if (currency === 'XMR') {
      let sub: { address: string; index: number };
      try {
        sub = await this.xmrWallet.createSubaddress(invoiceId);
      } catch (err) {
        this.logger.error(`XMR wallet error: ${(err as Error).message}`);
        throw new ServiceUnavailableException('XMR wallet is not available');
      }
      address = sub.address;

      await this.prisma.transaction.create({
        data: {
          userId,
          invoiceId,
          amountSats: BigInt(amountSats),
          address,
          currency,
          status: 'pending',
          subaddrIndex: sub.index,
          expiresAt,
        },
      });
    } else {
      let derived: { address: string; index: number };
      try {
        derived = await this.addressDerivation.deriveNextAddress(currency);
      } catch (err) {
        this.logger.error(`Address derivation error for ${currency}: ${(err as Error).message}`);
        throw new ServiceUnavailableException(`${currency} deposits are not configured`);
      }
      address = derived.address;

      // Track address before persisting — if NBXplorer is unreachable we avoid
      // creating an orphaned pending record that can never settle.
      try {
        await this.nbxplorer.trackAddress(currency, address);
      } catch (err) {
        this.logger.error(`NBXplorer track error for ${currency}: ${(err as Error).message}`);
        throw new ServiceUnavailableException('Blockchain indexer is not available');
      }

      await this.prisma.transaction.create({
        data: {
          userId,
          invoiceId,
          amountSats: BigInt(amountSats),
          address,
          currency,
          status: 'pending',
          expiresAt,
        },
      });
    }

    this.logger.log(`Created ${currency} deposit invoice ${invoiceId} for user ${userId}`);

    return {
      invoiceId,
      amountSats: amountSats.toString(),
      address,
      currency,
      status: 'pending',
      expiresAt: expiresAt.toISOString(),
    };
  }

  async getInvoiceStatus(
    invoiceId: string,
  ): Promise<{ status: string; confirmations: number; txid: string | null }> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { invoiceId },
      select: { status: true, confirmations: true, txid: true },
    });

    if (!transaction) throw new BadRequestException('Invoice not found');
    return transaction;
  }

  async getUserTransactions(userId: number): Promise<{
    pending: object[];
    history: object[];
  }> {
    const txs = await this.prisma.transaction.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const serialize = (tx: (typeof txs)[number]) => ({
      ...tx,
      amountSats: tx.amountSats.toString(),
    });

    return {
      pending: txs.filter((t) => t.status === 'pending').map(serialize),
      history: txs.filter((t) => t.status !== 'pending').map(serialize),
    };
  }

  async softDeleteTransaction(id: number, userId: number): Promise<void> {
    const tx = await this.prisma.transaction.findUnique({ where: { id } });

    if (!tx || tx.deletedAt !== null) {
      throw new BadRequestException('Transaction not found');
    }
    if (tx.userId !== userId) throw new ForbiddenException();
    if (tx.status === 'pending') {
      throw new BadRequestException('Cannot remove a pending invoice');
    }

    await this.prisma.transaction.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async getUserBalance(
    userId: number,
  ): Promise<{ balanceSats: string; balanceLitoshi: string; balancePiconero: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { balanceSats: true, balanceLitoshi: true, balancePiconero: true },
    });

    if (!user) throw new BadRequestException('User not found');

    return {
      balanceSats: user.balanceSats.toString(),
      balanceLitoshi: user.balanceLitoshi.toString(),
      balancePiconero: user.balancePiconero.toString(),
    };
  }
}
