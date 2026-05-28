BEGIN;

ALTER TABLE "MonthlyPlan" RENAME COLUMN "sip" TO "sipMf";
ALTER TABLE "MonthlyPlan" RENAME COLUMN "investment" TO "stocks";
ALTER TABLE "MonthlyPlan" RENAME COLUMN "liquidSaved" TO "savings";
ALTER TABLE "MonthlyPlan" RENAME COLUMN "otherIncome" TO "otherSources";
ALTER TABLE "MonthlyPlan" ADD COLUMN IF NOT EXISTS "fd" NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE "PftSetting" RENAME COLUMN "defaultOtherIncome" TO "defaultOtherSources";
ALTER TABLE "PftSetting" RENAME COLUMN "defaultSip" TO "defaultSipMf";
ALTER TABLE "PftSetting" RENAME COLUMN "defaultInvestment" TO "defaultStocks";
ALTER TABLE "PftSetting" RENAME COLUMN "defaultLiquidSaved" TO "defaultSavings";
ALTER TABLE "PftSetting" ADD COLUMN IF NOT EXISTS "defaultFd" NUMERIC NOT NULL DEFAULT 0;

COMMIT;
