# CC Txn Import Runtime (NestJS)

## Endpoint

- `POST /api/v1/import-jobs/cc-txn-import`
- Header: `X-Job-Token: <IMPORT_JOB_TOKEN>` (if configured)
- Body:
  - `dryRun?: boolean`
  - `bankKeys?: string[]`

## Gmail polling credentials

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `IMPORT_GOOGLE_REDIRECT_URI` (for reauth callback)
- refresh token is persisted in DB: `PftSetting.importGmailRefreshToken` (no env fallback)
- `IMPORT_GMAIL_USER` (default: `me`)
- `IMPORT_GMAIL_MAX_RESULTS` (default: `500`)
- `IMPORT_LABEL_SBI` (default: `CC Transactions/SBI`)
- `IMPORT_LABEL_HDFC` (default: `CC Transactions/HDFC`)
- `IMPORT_LABEL_ICICI` (default: `CC Transactions/ICICI`)
- `IMPORT_DEBUG_PARSER_INPUT` (default: `false`) — log parser miss message body previews
- `IMPORT_DEBUG_BODY_MAX_LEN` (default: `1200`) — max chars logged from body

## Re-auth endpoint

- Start flow: `GET /api/v1/auth/google/import/start`
- Callback: `GET /api/v1/auth/google/import/callback`

## Scheduler

- External scheduler trigger every 10 minutes:
  - cron: `*/10 * * * *`
  - timezone: `Asia/Kolkata`

## Locking

- Distributed lock key: `cc_txn_import`
- TTL: 20 minutes
- If lock is already held: returns run status `SKIPPED_LOCKED`

## Run lifecycle

1. Acquire lock.
2. Resolve bank list.
3. For each bank:
   - resolve incremental window from `ImportJobState`
   - poll Gmail by label/date
   - strict timestamp filter by watermark
   - parse + validate + dedupe
   - persist transactions
   - update watermark
4. Persist final summary in `ImportJobRun`.
5. Emit alerts for failures.
6. Release lock.

## Prisma tables

- `ImportJobLock`
- `ImportJobState`
- `ImportJobRun`
- `Transaction` (dedupe uniqueness via `(tenantId, dedupeKey)`)

