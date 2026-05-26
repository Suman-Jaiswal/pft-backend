ALTER TABLE "PftSetting"
  ADD COLUMN IF NOT EXISTS "dashboardBaselineVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "PftBaseline" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "lockedAt" TIMESTAMP NOT NULL,
  "lockedBy" TEXT NOT NULL,
  "metrics" JSONB NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_pft_baseline_tenant_period_version"
  ON "PftBaseline"("tenantId", "periodKey", "version");

CREATE INDEX IF NOT EXISTS "idx_pft_baseline_tenant_period"
  ON "PftBaseline"("tenantId", "periodKey");
