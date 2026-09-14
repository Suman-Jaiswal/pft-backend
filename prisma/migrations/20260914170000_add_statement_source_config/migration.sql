ALTER TABLE "PftSetting"
  ADD COLUMN IF NOT EXISTS "statementSourceConfig" JSONB;
