-- CreateTable
CREATE TABLE "ScratchPad" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "workbook" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "ScratchPad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_scratch_pads_tenant_sort" ON "ScratchPad"("tenantId", "sortOrder");
