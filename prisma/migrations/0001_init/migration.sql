-- users
CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- cards
CREATE TABLE "Card" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "cardKey" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "last4" TEXT,
  "network" TEXT,
  "statementCycleDay" INTEGER,
  "creditLimit" NUMERIC,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL
);
CREATE UNIQUE INDEX "uq_cards_tenant_card_key" ON "Card"("tenantId", "cardKey");

-- statements
CREATE TABLE "Statement" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "cardKey" TEXT NOT NULL,
  "statementMonth" TEXT NOT NULL,
  "dueDate" TIMESTAMP NOT NULL,
  "minimumAmountDue" NUMERIC NOT NULL,
  "totalAmountDue" NUMERIC NOT NULL,
  "status" TEXT NOT NULL,
  "statementSyncMonth" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  CONSTRAINT "fk_statement_card" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uq_statements_tenant_card_month" ON "Statement"("tenantId", "cardId", "statementMonth");

-- transactions
CREATE TABLE "Transaction" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "statementId" TEXT,
  "txnDate" TIMESTAMP NOT NULL,
  "amount" NUMERIC NOT NULL,
  "merchant" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "referenceNo" TEXT,
  "externalId" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  CONSTRAINT "fk_transaction_card" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_transaction_statement" FOREIGN KEY ("statementId") REFERENCES "Statement"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "uq_transactions_tenant_external_id" ON "Transaction"("tenantId", "externalId");
