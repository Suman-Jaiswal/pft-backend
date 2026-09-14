# CC Txn Import Runtime (NestJS)

## Endpoint

- `POST /api/v1/import-jobs/cc-txn-import` — **async**: returns as soon as the run row is created, the drain continues in the background.
- Header: `X-Job-Token: <IMPORT_JOB_TOKEN>` (if configured)
- Body:
  - `dryRun?: boolean`
  - `bankKeys?: string[]`
- Response: `{ jobRunId, status: 'RUNNING', startedAt }`
- `GET /api/v1/import-jobs/cc-txn-import/runs/:id` — poll for the final `ImportRunSummary`; `status` stays `RUNNING` and `completedAt` stays `null` until the drain finishes.
- `GET /api/v1/import-jobs/cc-txn-import/status` ignores in-flight runs, so the reauth banner keeps showing the last settled outcome.

## Gmail polling credentials

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `IMPORT_GOOGLE_REDIRECT_URI` (for reauth callback)
- refresh token is persisted in DB: `PftSetting.importGmailRefreshToken` (no env fallback)
- `IMPORT_GMAIL_USER` (default: `me`)
- `IMPORT_GMAIL_MAX_RESULTS` (default: `500`)
- `IMPORT_GMAIL_TIMEOUT_MS` (default: `30000`) — hard per-request timeout; googleapis has none, so a stalled token refresh would otherwise hang a run indefinitely. Each call is retried 3x, so a dead Gmail connection fails the run in ~90s.
- `IMPORT_LABEL_SBI` (default: `CC Transactions/SBI`)
- `IMPORT_LABEL_HDFC` (default: `CC Transactions/HDFC`)
- `IMPORT_LABEL_ICICI` (default: `CC Transactions/ICICI`)
- `IMPORT_TXN_LABEL_PARENT` (default: `CC Transactions`) — bank folders are discovered as direct children of this parent
- `IMPORT_TXN_GEMINI_BODY_MAX_LEN` (default: `4000`) — HTML-stripped body cap sent to Gemini
- `IMPORT_TXN_GEMINI_BATCH_SIZE` (default: `5`)
- `IMPORT_TXN_GEMINI_BATCH_GAP_MS` (default: `60000`)
- `IMPORT_TXN_FALLBACK_START_DATE` (default: `2026-03-01`)
- `IMPORT_DEBUG_PARSER_INPUT` (default: `false`) — log parser miss message body previews
- `IMPORT_DEBUG_BODY_MAX_LEN` (default: `1200`) — max chars logged from body

## Re-auth endpoint

- Start flow: `GET /api/v1/auth/google/import/start`
- Callback: `GET /api/v1/auth/google/import/callback`

## Scheduler

- External scheduler trigger hourly:
  - cron: `0 * * * *`
  - timezone: `Asia/Kolkata`

## Locking

- Distributed lock key: `cc_txn_import`
- TTL: 6 hours (drain + 60s between Gemini batches)
- If lock is already held: returns run status `SKIPPED_LOCKED`

## Run lifecycle

0. Create the `ImportJobRun` row as `RUNNING` and return `jobRunId` to the caller.
1. Acquire lock (on failure the row is set to `SKIPPED_LOCKED`).
2. Discover Gmail labels that are direct children of `CC Transactions` (`IMPORT_TXN_LABEL_PARENT`).
3. Resolve bank list from those label leaves (and Wallet issuers).
4. For each folder that matches a Wallet issuer (label leaf === issuer, exact):
   - resolve incremental window from `ImportJobState` (`LABEL:<folder>`, copying legacy `SBI_XX5965` / `HDFC_XX9335` / `ICICI_SHARED` on first read)
   - poll Gmail by that label only (no sender allowlist)
   - Gemini in batches of 5 (60s gap); regex fallback for SBI/HDFC/ICICI
   - route by last4 to Wallet `ISSUER_XX####`
   - persist + watermark `max(receivedAtMs)` as today
5. Update the same `ImportJobRun` row with the final summary and status.
6. Emit alerts for failures.
7. Release lock (in `finally`; a stale lock is also cleared on app startup).

## Prisma tables

- `ImportJobLock`
- `ImportJobState`
- `ImportJobRun`
- `Transaction` (dedupe uniqueness via `(tenantId, dedupeKey)`)

