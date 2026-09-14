# CC Txn Import Parser Parity Checklist (legacy)

**Retired.** Apps Script is not used. Live import is Nest `CcTxnImportService` in this repo. Do not use this file or `sync_cc_transactions.gs` as design source. See `cc-txn-import-runtime.md` and `cc-txn-import-wallet-routing-sdd.md`.

Historical reference (old Apps Script): `/Users/s0j0b3x/Personal/pft-appscripts/sync_cc_transactions.gs`

## SBI (`parseSbiTxn_`)

- [x] Amount parsing (`INR` / `Rs`)
- [x] Card last4 extraction (`XXdddd`)
- [x] Merchant extraction
- [x] Reference extraction
- [ ] Full Apps Script edge-case regex parity

## HDFC (`parseHdfcTxn_`)

- [x] Amount parsing (`INR` / `Rs`)
- [x] Card last4 extraction (`xxdddd`)
- [x] Sender allowlist check supported in runtime flow
- [x] Merchant/reference extraction
- [ ] Full merchant cleanup parity from Apps Script helper chain

## ICICI (`parseIciciTxn_`)

- [x] Amount parsing (`INR` / `Rs`)
- [x] Card last4 extraction (`XXdddd`)
- [x] Shared-card flow compatible (`knownCards`)
- [x] Merchant/reference extraction
- [ ] Full Apps Script edge-case regex parity

## Runtime Parity

- [x] Dedupe precedence: `EMAIL` -> `REF` -> fallback composite
- [x] One-bank failure isolation
- [x] Strict watermark timestamp filter (`receivedAtMs > cutoffMs`)
- [x] One-day buffered Gmail `after:` search window support
- [x] Watermark updates only after successful persistence path

