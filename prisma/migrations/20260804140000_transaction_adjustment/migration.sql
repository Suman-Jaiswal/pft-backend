-- CreateTable
CREATE TABLE "TransactionAdjustment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "personalShare" DECIMAL(65,30),
    "amortizeMonths" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "TransactionAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransactionAdjustment_transactionId_key" ON "TransactionAdjustment"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionAdjustment_tenantId_idx" ON "TransactionAdjustment"("tenantId");

-- AddForeignKey
ALTER TABLE "TransactionAdjustment" ADD CONSTRAINT "TransactionAdjustment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
