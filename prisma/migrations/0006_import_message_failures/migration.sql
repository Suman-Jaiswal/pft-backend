CREATE TABLE IF NOT EXISTS "ImportMessageFailure" (
  "id" TEXT NOT NULL,
  "jobKey" TEXT NOT NULL,
  "bankKey" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "receivedAtMs" BIGINT,
  "fromAddress" TEXT,
  "subject" TEXT,
  "bodyPreview" TEXT,
  "failureType" TEXT NOT NULL,
  "failureReason" TEXT NOT NULL,
  "errorText" TEXT,
  "status" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastRetriedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "resolvedTxnId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportMessageFailure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_import_message_failure_job_bank_msg"
  ON "ImportMessageFailure"("jobKey", "bankKey", "messageId");

CREATE INDEX IF NOT EXISTS "idx_import_message_failure_status_updated"
  ON "ImportMessageFailure"("status", "updatedAt");

CREATE INDEX IF NOT EXISTS "idx_import_message_failure_bank_status_updated"
  ON "ImportMessageFailure"("bankKey", "status", "updatedAt");
