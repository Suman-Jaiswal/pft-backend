# CC Txn Import Rollout and Rollback

## Feature flags / controls

- `IMPORT_JOB_TOKEN`: secure scheduler endpoint access
- `IMPORT_SHADOW_MODE`:
  - `true` -> dry-run only
  - `false` -> persistence enabled
- `IMPORT_ENABLED_BANKS`:
  - comma-separated bank keys for canary (example: `SBI_5965`)

## Phase plan

### Phase 1: Shadow mode

- Set `IMPORT_SHADOW_MODE=true`
- Run scheduled job for at least 48 hours.
- Compare run stats against Apps Script baseline.

### Phase 2: Single-bank canary

- Set `IMPORT_SHADOW_MODE=false`
- Set `IMPORT_ENABLED_BANKS=SBI_5965`
- Validate inserts/dedupes/watermarks/alerts.

### Phase 3: Full cutover

- Set `IMPORT_ENABLED_BANKS=SBI_5965,HDFC_9335,ICICI_SHARED`
- Disable Apps Script trigger for `importAllBanks`.
- Keep Apps Script callable manually as fallback for 1-2 weeks.

### Phase 4: Hardening

- Add replay tooling for parse failures.
- Add richer parser edge-case coverage from Apps Script.

## Rollback

1. Disable scheduler trigger immediately.
2. Re-enable Apps Script `cc_txn_import` trigger.
3. Keep backend endpoint available only for dry-run diagnostics.
4. Preserve `ImportJobRun` records for RCA.

## Acceptance checks

- No overlapping runs (`SKIPPED_LOCKED` only when expected).
- No duplicate inserts under retries.
- Watermark progression is monotonic.
- Failure and spend-cap alerts are emitted as expected.

