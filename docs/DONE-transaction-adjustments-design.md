# Transaction Adjustments — Design

Feature to layer SPLIT / EXCLUDE / AMORTIZE adjustments on credit-card transactions so
**Outstanding** (bank truth) and **Effective Spend** (personal burn) can coexist without
deleting transactions.

## Problem Statement

When you pay for friends on your card, or pay a multi-month subscription upfront, the full
amount hits the card and inflates cycle spend. Today the workaround is deleting those
transactions — which fixes personal-spend tracking but breaks outstanding / statement
reconciliation.

We need both numbers:

| Metric | Meaning | Source |
|--------|---------|--------|
| Outstanding | What the bank / statement sees | Raw `Transaction.amount` |
| Effective Spend | What counts toward your personal burn / Monthly Plan CC budget | Adjusted amount |

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Approach | Adjustment overlay table (raw txn never mutated) |
| Types | `SPLIT` · `EXCLUDE` · `AMORTIZE` |
| Reimbursements | Not tracked — only reduce personal share |
| Amount display | Same field; global Outstanding ↔ Effective switch |
| Switch scope | Global (all cards + summary KPIs) |
| Monthly Plan CC budget | Always Effective (no switch) |
| Amortize window | Calendar months |
| Outstanding for amortized txn | Full bank amount in the cycle/month it posts |
| AMORTIZE edit rule | Months only; monthly slice = `amount ÷ N` |
| Adjustments editable | Yes — create/replace via upsert; clear via delete |

## Architecture

```
Transaction (bank truth, immutable for this feature)
       │
       │ 0..1
       ▼
TransactionAdjustment (SPLIT | EXCLUDE | AMORTIZE)
       │
       ▼
┌──────────────────┐     ┌─────────────────────┐
│ Outstanding      │     │ Effective Spend     │
│ sum(amount)      │     │ sum(effective(txn)) │
│ cycle windows    │     │ calendar / cycle    │
└──────────────────┘     └─────────────────────┘
         │                         │
         ▼                         ▼
  Global switch fills        Monthly Plan CC
  card amount field          budget always
```

## Data Model

```prisma
model TransactionAdjustment {
  id             String   @id @default(cuid())
  tenantId       String
  transactionId  String   @unique
  type           String   // 'SPLIT' | 'EXCLUDE' | 'AMORTIZE'
  personalShare  Decimal? // SPLIT only
  amortizeMonths Int?     // AMORTIZE only, >= 2 and <= 60
  note           String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  createdBy      String
  updatedBy      String

  transaction Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)

  @@index([tenantId])
}
```

Add reverse relation on `Transaction`:

```prisma
model Transaction {
  // ... existing fields ...
  adjustment TransactionAdjustment?
}
```

### Validation rules

| Type | Required | Constraints |
|------|----------|-------------|
| `SPLIT` | `personalShare` | `0 < personalShare < amount` |
| `EXCLUDE` | — | `personalShare` / `amortizeMonths` must be null |
| `AMORTIZE` | `amortizeMonths` | `2 <= amortizeMonths <= 60`; `personalShare` null |

- Max one adjustment per transaction (unique `transactionId`; PUT replaces).
- Tenant-scoped; transaction must belong to tenant.
- Delete adjustment → Effective falls back to full `amount`.

## Effective Amount Formula

Two query contexts (do not mix):

### 1) Card cycle Effective (`effectiveCycleSpend`)

Membership = same as Outstanding: `txnDate` ∈ cycle window.

| Adjustment | Amount counted |
|------------|----------------|
| none | `A` |
| `SPLIT` | `personalShare` |
| `EXCLUDE` | `0` |
| `AMORTIZE` | `A / N` (one monthly slice only — the spread happens across calendar months in Monthly Plan, not by multiplying slices inside one cycle) |

So an amortized ₹12,000 / 12 txn that posts in this cycle contributes ₹1,000 to `effectiveCycleSpend` and ₹12,000 to `cycleSpend`.

### 2) Calendar-month Effective (Monthly Plan CC budget)

For calendar month `M` (`YYYY-MM`):

| Adjustment | Effective in `M` |
|------------|------------------|
| none | `A` if `txnDate` falls in `M` |
| `SPLIT` | `personalShare` if `txnDate` falls in `M` |
| `EXCLUDE` | `0` |
| `AMORTIZE` | `A / N` if `M` ∈ `[txnMonth … txnMonth + N - 1]`, else `0` (txn may have posted in an earlier month) |

Notes:

- AMORTIZE schedule uses **calendar months**, no day-proration.
- Division uses decimal rounding consistent with existing money handling (2 dp INR).
- Outstanding never uses these formulas — always raw `A` in the card cycle window.

## APIs

### Create / replace adjustment

```
PUT /api/v1/transactions/:id/adjustment
```

```json
{
  "type": "SPLIT",
  "personalShare": 750,
  "note": "Dinner with friends"
}
```

```json
{
  "type": "EXCLUDE",
  "note": "Reimbursable work expense"
}
```

```json
{
  "type": "AMORTIZE",
  "amortizeMonths": 12,
  "note": "Annual subscription"
}
```

Response: the saved adjustment (plus derived `monthlyAmount` for AMORTIZE = `amount / N`).

### Delete adjustment

```
DELETE /api/v1/transactions/:id/adjustment
```

### List / summary shape changes

`GET /transactions` items include optional:

```json
{
  "adjustment": {
    "type": "SPLIT",
    "personalShare": 750,
    "amortizeMonths": null,
    "monthlyAmount": null,
    "note": "Dinner with friends"
  }
}
```

`GET /transactions/card-cycle-summary` (cycle-data) per card:

```json
{
  "cycleSpend": 18500,
  "effectiveCycleSpend": 9200,
  "adjustedAmount": 9300
}
```

| Field | Meaning |
|-------|---------|
| `cycleSpend` | Outstanding — existing, unchanged semantics |
| `effectiveCycleSpend` | New — Effective for the same cycle window |
| `adjustedAmount` | `cycleSpend - effectiveCycleSpend` (convenience) |

Totals: also return `totalEffectiveCycleSpend` alongside existing `totalCycleSpend`.

### Monthly Plan CC budget

Any computation that feeds “CC spent this month” vs Monthly Plan budget **must** use
Effective for the calendar month. No client switch; server-side Effective only.

## Frontend UX

### Global switch

- Label: **Outstanding | Effective**
- Scope: all card amount fields + related KPI totals that currently show cycle spend
- Persistence: client-only (`localStorage`)
- Does **not** change: unsettled, min due, statement total, trend (all Outstanding / bank truth)

### Transaction rows

Primary amount remains bank amount. Badge when adjusted:

| Type | Badge | Secondary |
|------|-------|-----------|
| SPLIT | Split | Your share: ₹X |
| EXCLUDE | Excluded | — |
| AMORTIZE | Spread | ₹X/mo × N |

### Adjust flow

Row action → sheet/modal:

1. Split — edit your share + optional note  
2. Exclude — confirm + optional note  
3. Spread monthly — months (default 12) + optional note  
4. Clear adjustment — if one exists  

Existing adjustment pre-fills the form; save upserts.

## Edge Cases

| Case | Behavior |
|------|----------|
| Re-import same txn | Adjustment retained (`transactionId` stable) |
| Txn deleted | Adjustment cascade-deleted |
| AMORTIZE across past/future months | Monthly Plan: each covered calendar month gets `A/N`; card cycle: only if txn posted in that cycle, count `A/N` once |
| Sync-pending / unsettled | Outstanding-only math unchanged |
| Statement / trend | Always vs Outstanding |
| Invalid SPLIT / AMORTIZE | HTTP 400 |

## Out of Scope (v1)

- Per-friend receivable tracking / Splitwise-style balances
- Auto-detect subscriptions
- Adjustment templates / recurring rules
- Day-level proration of amortize
- Changing bank `Transaction.amount`

## Implementation Order

1. Prisma migration: `TransactionAdjustment` + relation on `Transaction`
2. Adjustment service + validation
3. `PUT` / `DELETE` adjustment endpoints
4. Effective amount helper (calendar-month aware for AMORTIZE)
5. Extend card-cycle-summary with `effectiveCycleSpend` / totals
6. Include `adjustment` on paginated transaction list
7. Wire Monthly Plan CC-spent path to Effective
8. Frontend: global switch + amount field binding
9. Frontend: badges on rows + adjust / clear UI
10. Invalidate cycle-summary (+ Monthly Plan queries) after adjustment mutations

## Design Principles

| Principle | How |
|-----------|-----|
| Bank truth immutable | Never mutate / delete txn for spend hygiene |
| Two metrics, one field | Global switch; backend always returns both |
| Budget uses reality | Monthly Plan CC always Effective |
| Amortize matches plans | Calendar months, not statement cycles |
| Reversible | Delete adjustment restores full Effective |
| YAGNI | No receivables, no auto-detect in v1 |
