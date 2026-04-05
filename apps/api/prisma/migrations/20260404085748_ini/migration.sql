-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL DEFAULT '',
    "mnemonicHash" TEXT NOT NULL DEFAULT '',
    "mnemonicConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "balanceSats" BIGINT NOT NULL DEFAULT 0,
    "balanceLitoshi" BIGINT NOT NULL DEFAULT 0,
    "balancePiconero" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "pair" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("pair")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountSats" BIGINT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'BTC',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "txid" TEXT,
    "subaddrIndex" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletConfig" (
    "currency" TEXT NOT NULL,
    "xpub" TEXT NOT NULL,
    "nextIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WalletConfig_pkey" PRIMARY KEY ("currency")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_invoiceId_key" ON "Transaction"("invoiceId");

-- CreateIndex
CREATE INDEX "Transaction_address_idx" ON "Transaction"("address");

-- CreateIndex
CREATE INDEX "Transaction_status_expiresAt_idx" ON "Transaction"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
