# Slice Credit Card — Statement Sync

**Status: READY TO DEPLOY**

## Key Decision

Slice does **not** send per-transaction alert emails. Only a monthly compiled statement is sent to the registered email. Transactions for Slice are managed **manually** (same as CSB).

The only automated flow is **statement sync** — extracting due date, total due, and minimum due from the monthly statement email.

## Configuration

- **Card key**: `SLICE_XX6447`
- **Statement flow**: `direct` (email body contains all fields in plain text)
- **Sender**: `noreply@slice.bank.in`
- **Statement label**: `CC Statements/slice_xx6447_statements`
- **No transaction import** — manual entry only

## What's Wired

- [x] `statementLabelSlice` in `app.config.ts`
- [x] `STATEMENT_LABEL_SLICE` in `.env` and `.env.prod`
- [x] Slice added to `STATEMENT_SOURCES` in `cc-statements-import.service.ts` with `flow: 'direct'`
- [x] Gemini will parse the email body to extract: total due, minimum due, due date

## Remaining (Manual Steps)

- [ ] Create Slice card entity in prod (`POST /cards`):
  - cardKey: `SLICE_XX6447`
  - issuer: `SLICE`
  - last4: `6447`
  - statementCycleDay: TBD (looks like ~11th from the Jun statement email dated Jun 11)
- [ ] Create Gmail label: `CC Statements/slice_xx6447_statements`
- [ ] Label the existing Slice statement email(s) under that label
- [ ] Deploy and run statement sync to verify

## Notes

- Statement email body contains: "Total amount due: ₹1,463 / Minimum due: ₹200 / Due date: 1 Jul '26"
- Gemini handles this format easily in `direct` flow
- Transactions must be added manually via the app (no automated txn import)
- Same approach as CSB card
