CREATE TABLE "DetailedStatement" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "cardKey" TEXT NOT NULL,
  "labelName" TEXT NOT NULL,
  "gmailMessageId" TEXT NOT NULL,
  "gmailInternalMs" BIGINT,
  "attachmentId" TEXT,
  "statementId" TEXT,
  "statementMonth" TEXT,
  "entryIndex" INTEGER NOT NULL,
  "entryHash" TEXT NOT NULL,
  "txnDate" TIMESTAMP(3),
  "amount" DECIMAL(65,30),
  "merchant" TEXT,
  "currency" TEXT,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  CONSTRAINT "DetailedStatement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_detailed_statement_message_entry"
  ON "DetailedStatement"("tenantId", "cardKey", "gmailMessageId", "entryHash");

CREATE INDEX "idx_detailed_statement_tenant_card_month"
  ON "DetailedStatement"("tenantId", "cardId", "statementMonth");

CREATE INDEX "idx_detailed_statement_tenant_label"
  ON "DetailedStatement"("tenantId", "labelName");

ALTER TABLE "DetailedStatement"
  ADD CONSTRAINT "DetailedStatement_cardId_fkey"
  FOREIGN KEY ("cardId") REFERENCES "Card"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DetailedStatement"
  ADD CONSTRAINT "DetailedStatement_statementId_fkey"
  FOREIGN KEY ("statementId") REFERENCES "Statement"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
