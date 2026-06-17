ALTER TABLE "MonthlyPlan"
  ADD COLUMN IF NOT EXISTS "stash" NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE "PftSetting"
  RENAME COLUMN "stashBalance" TO "stashDeductions";
