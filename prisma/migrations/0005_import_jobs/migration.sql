CREATE UNIQUE INDEX IF NOT EXISTS "uq_transactions_tenant_dedupe_key" ON "Transaction"("tenantId", "dedupeKey");

CREATE TABLE IF NOT EXISTS "ImportJobLock" (
  "jobKey" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportJobLock_pkey" PRIMARY KEY ("jobKey")
);

CREATE TABLE IF NOT EXISTS "ImportJobState" (
  "id" TEXT NOT NULL,
  "jobKey" TEXT NOT NULL,
  "bankKey" TEXT NOT NULL,
  "watermarkIso" TEXT,
  "watermarkCutoffMs" BIGINT,
  "source" TEXT NOT NULL,
  "lastStartDate" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportJobState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ImportJobRun" (
  "id" TEXT NOT NULL,
  "jobKey" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportJobRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_import_job_state_job_bank" ON "ImportJobState"("jobKey", "bankKey");
CREATE INDEX IF NOT EXISTS "idx_import_job_run_job_created" ON "ImportJobRun"("jobKey", "createdAt");
