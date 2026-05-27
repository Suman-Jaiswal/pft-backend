ALTER TABLE "PftSetting"
ADD COLUMN "importGmailRefreshToken" TEXT,
ADD COLUMN "importGmailEmail" TEXT,
ADD COLUMN "importGmailScope" TEXT,
ADD COLUMN "importGmailTokenUpdatedAt" TIMESTAMP(3);
