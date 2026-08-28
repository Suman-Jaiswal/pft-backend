ALTER TABLE "PftSetting"
  ADD COLUMN IF NOT EXISTS "planDefaultSlates" JSONB;
