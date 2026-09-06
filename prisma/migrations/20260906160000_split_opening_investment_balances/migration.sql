ALTER TABLE "PftSetting" ADD COLUMN "prevMfBalance" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "PftSetting" ADD COLUMN "prevStocksBalance" DECIMAL(65,30) NOT NULL DEFAULT 0;

UPDATE "PftSetting"
SET "prevStocksBalance" = "prevInvestmentBalance";
