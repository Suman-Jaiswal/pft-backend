CREATE TABLE "InvestmentSale" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "assetType" TEXT NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  CONSTRAINT "InvestmentSale_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvestmentSale_assetType_check" CHECK ("assetType" IN ('MF', 'STOCKS')),
  CONSTRAINT "InvestmentSale_amount_check" CHECK ("amount" > 0)
);

CREATE INDEX "idx_investment_sales_tenant_asset_created"
  ON "InvestmentSale"("tenantId", "assetType", "createdAt");
