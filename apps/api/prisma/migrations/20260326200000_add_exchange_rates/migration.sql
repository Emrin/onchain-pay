-- CreateTable
CREATE TABLE "ExchangeRate" (
    "pair"      TEXT NOT NULL,
    "rate"      DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("pair")
);
