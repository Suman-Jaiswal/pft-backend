# CC Txn Import Failure Replay Runbook

## New APIs

- `GET /api/v1/import-jobs/cc-txn-failures`
  - Header: `X-Job-Token`
  - Query: `status`, `failureType`, `bankKeys[]`, `page`, `pageSize`
- `POST /api/v1/import-jobs/cc-txn-failures/retry`
  - Header: `X-Job-Token`
  - Body: `ids[]` or `bankKeys[] + limit`, optional `dryRun`
- `POST /api/v1/import-jobs/cc-txn-import/rebase-watermark`
  - Header: `X-Job-Token`
  - Body: `days` (default 10), optional `bankKeys[]`, optional `dryRun`

## Failure lifecycle

- Parse miss / parse error / card-rule mismatch / write failure are persisted in `ImportMessageFailure`.
- Each failure is keyed by `(jobKey, bankKey, messageId)`.
- Retry path fetches Gmail by `messageId` and re-runs parser + dedupe + persistence.
- Successful retry marks row `RESOLVED`; unresolved rows go back to `OPEN`.

## 10-day recovery sequence

1. Deploy migration and app.
2. Dry-run watermark rebase:
   - `POST /cc-txn-import/rebase-watermark` with `{ "days": 10, "dryRun": true }`
3. Apply watermark rebase:
   - `POST /cc-txn-import/rebase-watermark` with `{ "days": 10 }`
4. Execute normal import job.
5. List open failures:
   - `GET /cc-txn-failures?status=OPEN`
6. Patch parser logic for top failure reasons.
7. Retry failures by IDs or bank:
   - `POST /cc-txn-failures/retry`
8. Confirm unresolved backlog is shrinking over repeated runs.

## Verification checklist

- `ImportJobRun.aggregate.parseMiss` trend decreases after parser patches.
- `ImportMessageFailure` status mix moves from `OPEN` to `RESOLVED`.
- Retry endpoint resolves duplicate-safe rows without duplicate inserts.
- Normal import endpoint still works unchanged when no failure rows exist.
