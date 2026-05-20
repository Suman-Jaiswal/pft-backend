CREATE TABLE "PftSetting" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "defaultSalary" NUMERIC NOT NULL DEFAULT 0,
  "defaultOtherIncome" NUMERIC NOT NULL DEFAULT 0,
  "defaultRent" NUMERIC NOT NULL DEFAULT 0,
  "defaultCook" NUMERIC NOT NULL DEFAULT 0,
  "defaultLoanRepayment" NUMERIC NOT NULL DEFAULT 0,
  "defaultSip" NUMERIC NOT NULL DEFAULT 0,
  "defaultInvestment" NUMERIC NOT NULL DEFAULT 0,
  "defaultLiquidSaved" NUMERIC NOT NULL DEFAULT 0,
  "defaultBills" NUMERIC NOT NULL DEFAULT 0,
  "defaultBasicExpenses" NUMERIC NOT NULL DEFAULT 0,
  "defaultOtherExpenses" NUMERIC NOT NULL DEFAULT 0,
  "prevLiquidBalance" NUMERIC NOT NULL DEFAULT 0,
  "prevInvestmentBalance" NUMERIC NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL
);

CREATE UNIQUE INDEX "uq_pft_settings_tenant" ON "PftSetting"("tenantId");
