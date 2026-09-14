# SDD: Wallet-routed CC txn import (Nest)

Status: **implemented** (v1 in Nest). External cron must be changed to hourly.
Runtime: **pft-backend** `CcTxnImportService` only.
Out of scope: pft-app (except later status UI if needed), Apps Script / `pft-appscripts`, statement import (`cc-statements-import`).

Apps Script is retired. Do not use `sync_cc_transactions.gs` or `cc-txn-import-parser-parity.md` as design source. The live path is:

- `POST /api/v1/import-jobs/cc-txn-import` (`X-Job-Token`, `X-Tenant-Id`)
- External cron (today `*/10 * * * *` Asia/Kolkata; this change moves it to hourly)
- Gmail poll via `PftSetting.importGmailRefreshToken` for that tenant
- Persist `Transaction` rows; watermark in `ImportJobState`

---

## Problem

Today banks are **hardcoded** in `DEFAULT_BANKS`:

| bankKey | Gmail label (env default) | extra filters |
|---|---|---|
| `SBI_XX5965` | `CC Transactions/SBI` | last4 must be `5965` |
| `HDFC_XX9335` | `CC Transactions/HDFC` | last4 `9335` **and** sender allowlist |
| `ICICI_SHARED` | `CC Transactions/ICICI` | `knownCards` `5000`, `9003` |

A mail that parses but has another last4 (e.g. SBI Cashback in the same `CC Transactions/SBI` folder) is dropped as `card_rule_mismatch`. Adding a Wallet card does not onboard it.

HDFC also drops mail whose `From` is not on `alerts@hdfcbank.bank.in` / `alerts@hdfcbank.net` **before** parse. That extra filter goes away: **label only**.

---

## Goals

1. New **card** for an existing bank folder: Wallet add only.
2. One Gmail folder per bank (`CC Transactions/<Issuer>`). Label leaf = Wallet issuer (`SBI`, `HDFC`, `ICICI`, **`AUSFB`** — not aliased to `AU`).
3. Gemini on every new mail, batches of ≤5; **drain** the watermark window this run; **wait 1 minute** between Gemini batches.
4. Gemini fail → existing regex parser for that issuer if one exists → else skip.
5. Route by parsed last4 → Wallet `ISSUER_XX####`. Unknown last4 → skip (no insert).
6. Watermark **per Gmail label**, same advance rule as today.

---

## Locked decisions

| Topic | Decision |
|---|---|
| Source of truth | Nest `cc-txn-import` |
| Gemini key / model | **Same as statements**: `STATEMENT_GEMINI_API_KEY` + current statement model (`gemini-2.5-flash` default) |
| Tenant | **Keep current**: each run is already tenant-scoped via `X-Tenant-Id` (Gmail token, Wallet cards, `Transaction`, `ImportJobRun`). `ImportJobState` stays `(jobKey, bankKey)` — no `tenantId` column today; do not add one in v1 |
| Parent label | **`CC Transactions`** (same as today). Children: `CC Transactions/SBI`, `.../HDFC`, `.../AUSFB`, etc. |
| Issuer / folder | Label leaf **is** the issuer. Folder `AUSFB` matches Wallet `AUSFB_*` only. Do not map `AUSFB` → `AU` |
| Drain | Process **all** new mails in the window this run. Gemini ≤5 per request; **sleep 60s** before the next batch |
| Watermark vs fail | **Same as today**: after the folder’s messages are attempted, set watermark to `max(receivedAtMs)`. Parse miss / skip / card missing still advance. Retry via `ImportMessageFailure` |
| Body to Gemini | Strip HTML; cap length (4k chars, same idea as debug body cap) |
| Inbox filter | **Gmail label only**. Drop HDFC `senderAllowlist`. No From-prefilter |
| Parser | Gemini always; regex fallback on Gemini failure or `ok: false` |
| Routing | Wallet last4 / `ISSUER_XX####` |
| Unknown last4 | Skip + failure record (`card_missing` / mismatch) |
| Watermark key | One cursor per **label** (not per card) |
| Cron | Hourly, Asia/Kolkata |
| Lock | Keep `cc_txn_import`; raise TTL so drain + 1 min between batches cannot hit 20 min |
| Settings UI | Not in v1 |

---

## What “label only” means (Q8)

Today HDFC does two filters: (1) Gmail label `CC Transactions/HDFC`, then (2) skip if `From` is not on a hardcoded sender list.

That second step is **removed**. If the mail is in the bank folder, it is a candidate. Gemini (or regex fallback) decides whether it is a txn. OTP / promo / other noise in that folder is skipped by parse, not by sender.

---

## Tenant note (Q2)

The job **already runs per tenant**. Gmail refresh token, Wallet lookup, and inserts are tenant-filtered. Status/runs query `ImportJobRun` by `tenantId`.

`ImportJobState` is **not** a per-tenant table (unique `(jobKey, bankKey)` only). That matches “as of now”. v1 keeps it. Safe while there is one tenant / one Gmail inbox for this job.

**Follow-up when a second tenant is real:** add `tenantId` to `ImportJobState` (and unique `(tenantId, jobKey, bankKey)`), migrate existing rows to the current tenant, and read/write watermarks scoped to `X-Tenant-Id`. Same gap exists on `ImportJobLock` (`jobKey` only) — tenant-scope that lock in the same change so two tenants cannot block each other.

---

## Target flow (one tenant run)

1. Acquire lock `cc_txn_import`.
2. Load Wallet cards for the tenant: `issuer`, `last4`, `cardKey`, `cardStatus`.
3. List Gmail labels; take **direct children** of `CC Transactions`.
4. For each child label whose leaf matches at least one Wallet `issuer` (exact, e.g. `AUSFB`):
   1. Resolve watermark for that label key (migrate from old `SBI_XX5965` / `HDFC_XX9335` / `ICICI_SHARED` on first run).
   2. Poll that label (`after:` + `receivedAtMs > cutoffMs`) — **no sender filter**.
   3. Drain: walk all filtered messages in order, Gemini in chunks of ≤5, **wait 60s between chunks**.
   4. Gemini fail / bad JSON / `ok: false` → regex if issuer is SBI/HDFC/ICICI; else skip.
   5. Map last4 → Wallet card with `issuer === label leaf`. Missing → skip + failure.
   6. Dedupe / persist (`EMAIL` → `REF` → composite).
   7. `updateWatermark` to max `receivedAtMs` of attempted messages (today’s rule).
5. Write `ImportJobRun` summary.
6. Release lock.

Folders with zero Wallet cards for that issuer: skip folder, log, do not touch watermark.

---

## Gemini contract (v1)

Same client / key / model as statement import.

Per batch (≤5):

- gmail id, from, receivedAt, subject, HTML-stripped body (max 4000 chars)
- Extract credit-card **alert** txns only (not OTPs, not statements)
- JSON array, same length/order, keyed by `gmailMessageId`
- Fields: `ok`, `last4`, `amount`, `txnDate`, `merchant`, `referenceNo`, `channel?`, `skipReason?`

---

## Watermark migration

Old keys: `SBI_XX5965`, `HDFC_XX9335`, `ICICI_SHARED`.

New keys: label-stable, e.g. `LABEL:CC Transactions/SBI`.

First run: if new key missing, **copy** old folder watermark. Do not reset to `fallbackStartDate`.

`Transaction.bankKey` on new rows: the label key. Old rows unchanged.

---

## FE

No v1 work. Wallet Sync stays statement import.

---

## Tests

- Discover only children of `CC Transactions`.
- Two SBI last4s in one folder both insert; one watermark.
- `AUSFB` folder routes only to `AUSFB_XX####`, not `AU_*`.
- No sender allowlist skip for HDFC.
- Unknown last4 skipped; watermark still advances (today).
- Drain 6 mails = 2 Gemini calls with 60s gap (test can fake sleep).
- Gemini 429 → regex insert.
- Gemini + regex fail → `ImportMessageFailure`; watermark still advances.
- Label-key watermark copied from `SBI_XX5965`.

---

## Rollout

1. Ship Nest.
2. Change external cron to `0 * * * *` Asia/Kolkata when Gemini-always is live.
3. Lock TTL ≥ drain + (batches − 1) × 60s + Gmail time.
4. Watch Gemini vs regex fallback rate.

---

## Explicitly not designed from

- Apps Script / `sync_cc_transactions.gs`
- `docs/domain/cc-txn-import-parser-parity.md`
