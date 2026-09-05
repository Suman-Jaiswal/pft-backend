-- Hard-cutover monthly/settings FD scalars to packet JSON.
ALTER TABLE "MonthlyPlan" ADD COLUMN "goalPayments" JSONB;
ALTER TABLE "MonthlyPlan" ALTER COLUMN "fd" DROP DEFAULT;
ALTER TABLE "MonthlyPlan"
  ALTER COLUMN "fd" TYPE JSONB
  USING jsonb_build_object(
    'amount', "fd",
    'quantity', CASE WHEN "fd" > 0 THEN 1 ELSE 0 END
  );
ALTER TABLE "MonthlyPlan"
  ALTER COLUMN "fd" SET DEFAULT '{"amount":0,"quantity":0}'::jsonb;

ALTER TABLE "PftSetting" ADD COLUMN "defaultGoalPayments" JSONB;
ALTER TABLE "PftSetting" ALTER COLUMN "defaultFd" DROP DEFAULT;
ALTER TABLE "PftSetting"
  ALTER COLUMN "defaultFd" TYPE JSONB
  USING jsonb_build_object(
    'amount', "defaultFd",
    'quantity', CASE WHEN "defaultFd" > 0 THEN 1 ELSE 0 END
  );
ALTER TABLE "PftSetting"
  ALTER COLUMN "defaultFd" SET DEFAULT '{"amount":0,"quantity":0}'::jsonb;

-- Convert leftover scalar FD inside planDefaultSlates[].defaults.fd only.
-- Skip null/non-array slates, missing defaults, missing fd, and already-object fd.
UPDATE "PftSetting" AS s
SET "planDefaultSlates" = converted.slates
FROM (
  SELECT
    src.id,
    COALESCE(
      (
        SELECT jsonb_agg(row.elem ORDER BY row.ord)
        FROM jsonb_array_elements(src."planDefaultSlates") WITH ORDINALITY AS t(elem, ord)
        CROSS JOIN LATERAL (
          SELECT
            t.ord,
            CASE
              WHEN jsonb_typeof(t.elem) <> 'object' THEN t.elem
              WHEN jsonb_typeof(t.elem->'defaults') <> 'object' THEN t.elem
              WHEN jsonb_typeof(t.elem->'defaults'->'fd') = 'number'
                OR (
                  jsonb_typeof(t.elem->'defaults'->'fd') = 'string'
                  AND (t.elem->'defaults'->>'fd') ~ '^-?[0-9]+(\.[0-9]+)?$'
                )
              THEN jsonb_set(
                t.elem,
                '{defaults,fd}',
                jsonb_build_object(
                  'amount', (t.elem->'defaults'->>'fd')::numeric,
                  'quantity', CASE
                    WHEN (t.elem->'defaults'->>'fd')::numeric > 0 THEN 1
                    ELSE 0
                  END
                )
              )
              ELSE t.elem
            END AS elem
        ) AS row
      ),
      '[]'::jsonb
    ) AS slates
  FROM "PftSetting" AS src
  WHERE jsonb_typeof(src."planDefaultSlates") = 'array'
) AS converted
WHERE s.id = converted.id;

CREATE TABLE "Goal" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "targetAmount" DECIMAL(65,30),
  "deadline" TIMESTAMP(3),
  "priority" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_goals_tenant_status" ON "Goal"("tenantId", "status");

CREATE TABLE "FdLedgerEntry" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "year" INTEGER,
  "month" INTEGER,
  "sourceEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  CONSTRAINT "FdLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_fd_ledger_tenant_year_month"
  ON "FdLedgerEntry"("tenantId", "year", "month");
CREATE INDEX "idx_fd_ledger_tenant_kind_created"
  ON "FdLedgerEntry"("tenantId", "kind", "createdAt");
CREATE INDEX "idx_fd_ledger_source" ON "FdLedgerEntry"("sourceEntryId");
ALTER TABLE "FdLedgerEntry"
  ADD CONSTRAINT "FdLedgerEntry_sourceEntryId_fkey"
  FOREIGN KEY ("sourceEntryId") REFERENCES "FdLedgerEntry"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed one contribution lot for every historical non-zero monthly FD.
INSERT INTO "FdLedgerEntry" (
  "id", "tenantId", "kind", "amount", "quantity",
  "year", "month", "createdAt", "createdBy"
)
SELECT
  'fdl_mig_' || md5("tenantId" || ':' || "year"::text || ':' || "month"::text),
  "tenantId",
  'CONTRIBUTION',
  ("fd"->>'amount')::DECIMAL,
  ("fd"->>'quantity')::INTEGER,
  "year",
  "month",
  "createdAt",
  "createdBy"
FROM "MonthlyPlan"
WHERE ("fd"->>'quantity')::INTEGER > 0;
