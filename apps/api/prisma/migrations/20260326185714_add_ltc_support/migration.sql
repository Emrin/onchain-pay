-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'BTC';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "balanceLitoshi" BIGINT NOT NULL DEFAULT 0;
