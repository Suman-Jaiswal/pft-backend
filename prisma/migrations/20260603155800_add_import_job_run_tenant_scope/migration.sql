-- Add tenant scope to import job runs for per-tenant status lookups.
ALTER TABLE "ImportJobRun"
ADD COLUMN "tenantId" TEXT;

CREATE INDEX "idx_import_job_run_job_tenant_created"
ON "ImportJobRun"("jobKey", "tenantId", "createdAt");
