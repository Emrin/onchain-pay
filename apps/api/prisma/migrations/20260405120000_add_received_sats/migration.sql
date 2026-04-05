-- Add receivedSats to record the actual on-chain amount separately from the
-- invoice requested amount (amountSats). Allows underpayment detection and
-- correct crediting without losing the original invoice amount.
ALTER TABLE "Transaction" ADD COLUMN "receivedSats" BIGINT;
