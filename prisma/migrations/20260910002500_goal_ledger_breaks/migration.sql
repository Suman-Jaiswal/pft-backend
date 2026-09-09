CREATE TABLE "GoalLedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "GoalLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_goal_ledger_tenant_goal_kind" ON "GoalLedgerEntry"("tenantId", "goalId", "kind");
CREATE INDEX "idx_goal_ledger_tenant_kind_created" ON "GoalLedgerEntry"("tenantId", "kind", "createdAt");
