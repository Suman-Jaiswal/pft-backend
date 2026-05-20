CREATE TABLE IF NOT EXISTS "MonthlyPlan" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "month" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "rent" NUMERIC NOT NULL DEFAULT 0,
  "cook" NUMERIC NOT NULL DEFAULT 0,
  "sip" NUMERIC NOT NULL DEFAULT 0,
  "bills" NUMERIC NOT NULL DEFAULT 0,
  "basicCcSpent" NUMERIC NOT NULL DEFAULT 0,
  "loanPayments" JSONB,
  "investment" NUMERIC NOT NULL DEFAULT 0,
  "liquidSaved" NUMERIC NOT NULL DEFAULT 0,
  "otherExpenses" NUMERIC NOT NULL DEFAULT 0,
  "customExpenses" JSONB,
  "salary" NUMERIC NOT NULL DEFAULT 0,
  "otherIncome" NUMERIC NOT NULL DEFAULT 0,
  "banks" JSONB,
  "remarks" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_monthly_plans_tenant_year_month" ON "MonthlyPlan"("tenantId", "year", "month");

CREATE TABLE IF NOT EXISTS "Bill" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL DEFAULT 0,
  "dueDay" INTEGER NOT NULL,
  "frequency" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "Loan" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "principal" NUMERIC NOT NULL DEFAULT 0,
  "emi" NUMERIC NOT NULL DEFAULT 0,
  "rate" NUMERIC NOT NULL DEFAULT 0,
  "startDate" TIMESTAMP NOT NULL,
  "tenureMonths" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL
);

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "txnTimestamp" TIMESTAMP;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "bankKey" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "emailId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "importedAt" TIMESTAMP;

ALTER TABLE "PftSetting" ADD COLUMN IF NOT EXISTS "dashboardYearRange" TEXT;
