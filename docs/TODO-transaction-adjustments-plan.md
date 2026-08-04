# Transaction Adjustments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SPLIT / EXCLUDE / AMORTIZE overlays so card Outstanding (bank truth) and Effective Spend (personal burn) coexist, with a global UI switch and Monthly Plan Variable Spend Limit always using Effective.

**Architecture:** Keep `Transaction` immutable. Persist optional 1:1 `TransactionAdjustment`. Pure helper computes Effective; card-cycle-summary returns both `cycleSpend` and `effectiveCycleSpend`; calendar-month Effective drives the Monthly Plan CC budget check. Frontend global Outstanding|Effective switch binds the same amount field.

**Tech Stack:** NestJS + Prisma (Postgres), Jest; React + React Query + Vite (pft-app); existing `ok()` API envelope.

**Spec:** `docs/TODO-transaction-adjustments-design.md`

## Global Constraints

- Never mutate or delete a transaction for spend hygiene; adjustments only.
- Outstanding = raw `Transaction.amount` in card cycle windows (existing semantics).
- Effective types: `SPLIT` | `EXCLUDE` | `AMORTIZE` only.
- AMORTIZE: months only (`2..60`); monthly slice = `amount / N` (2 dp INR).
- SPLIT: `0 < personalShare < amount`.
- Global switch is client-only (`localStorage` key `pft-spend-mode`).
- Monthly Plan Variable Spend Limit (`planDefaults.basicExpenses`) always compares against **calendar-month Effective**, never Outstanding.
- Unsettled / min due / statement / trend stay Outstanding-only.
- Process TZ is `Asia/Kolkata` (already set in `src/main.ts`).

## File Structure

| File | Responsibility |
|------|----------------|
| `prisma/schema.prisma` | `TransactionAdjustment` model + relation |
| `src/modules/transactions/domain/effective-amount.ts` | Pure Effective math |
| `src/modules/transactions/services/transaction-adjustment.service.ts` | Upsert/delete + validation |
| `src/modules/transactions/presentation/dto/upsert-transaction-adjustment.dto.ts` | Request DTO |
| `src/modules/transactions/transactions.controller.ts` | `PUT/DELETE :id/adjustment` |
| `src/modules/transactions/transactions.module.ts` | Register adjustment service |
| `src/modules/transactions/services/card-cycle-summary.service.ts` | Add Effective fields |
| `src/infrastructure/repositories/prisma-transaction.repository.ts` | Include `adjustment` on list |
| `pft-app/src/lib/apiClient.ts` | Allow `PUT` in `apiSend` |
| `pft-app/src/lib/pftData.ts` | Types, fetch mapping, mutation helpers |
| `pft-app/src/context/SpendModeContext.tsx` | Global Outstanding\|Effective preference |
| `pft-app/src/hooks/useBillingCycle.ts` | Expose both totals; mode-aware display amount |
| `pft-app/src/features/dashboard/components/WalletCard.tsx` | Bind switched amount |
| `pft-app/src/features/expenses/components/*` | Switch UI, limit uses Effective, badges, adjust sheet |

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_transaction_adjustment/migration.sql` (via CLI)

**Interfaces:**
- Produces: Prisma model `TransactionAdjustment`; `Transaction.adjustment` optional relation

- [ ] **Step 1: Add model to schema**

In `prisma/schema.prisma`, add to `Transaction`:

```prisma
  adjustment TransactionAdjustment?
```

Add new model:

```prisma
model TransactionAdjustment {
  id             String   @id @default(cuid())
  tenantId       String
  transactionId  String   @unique
  type           String
  personalShare  Decimal?
  amortizeMonths Int?
  note           String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  createdBy      String
  updatedBy      String

  transaction Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)

  @@index([tenantId])
}
```

- [ ] **Step 2: Create migration**

Run from `pft-backend`:

```bash
npm run prisma:migrate:dev -- --name transaction_adjustment
```

Expected: migration applied; client generated.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add TransactionAdjustment schema for spend overlays"
```

---

### Task 2: Effective amount pure helper (TDD)

**Files:**
- Create: `src/modules/transactions/domain/effective-amount.ts`
- Create: `src/modules/transactions/domain/effective-amount.spec.ts`

**Interfaces:**
- Produces:
  - `type AdjustmentType = 'SPLIT' | 'EXCLUDE' | 'AMORTIZE'`
  - `type AdjustmentInput = { type: AdjustmentType; personalShare?: number | null; amortizeMonths?: number | null }`
  - `effectiveForCycleTxn(amount: number, adjustment: AdjustmentInput | null): number`
  - `effectiveForCalendarMonth(amount: number, txnDate: Date, monthKey: string, adjustment: AdjustmentInput | null): number`
  - `formatMonthKey(date: Date): string` → `YYYY-MM`
  - `roundMoney(n: number): number` → 2 dp

- [ ] **Step 1: Write failing tests**

```typescript
import {
  effectiveForCycleTxn,
  effectiveForCalendarMonth,
  formatMonthKey,
} from '@/modules/transactions/domain/effective-amount'

describe('effective-amount', () => {
  it('cycle: no adjustment returns full amount', () => {
    expect(effectiveForCycleTxn(12000, null)).toBe(12000)
  })

  it('cycle: SPLIT returns personalShare', () => {
    expect(effectiveForCycleTxn(3000, { type: 'SPLIT', personalShare: 750 })).toBe(750)
  })

  it('cycle: EXCLUDE returns 0', () => {
    expect(effectiveForCycleTxn(3000, { type: 'EXCLUDE' })).toBe(0)
  })

  it('cycle: AMORTIZE returns one monthly slice', () => {
    expect(effectiveForCycleTxn(12000, { type: 'AMORTIZE', amortizeMonths: 12 })).toBe(1000)
  })

  it('calendar: AMORTIZE contributes in covered months only', () => {
    const txnDate = new Date(2026, 6, 20) // Jul 2026
    const adj = { type: 'AMORTIZE' as const, amortizeMonths: 3 }
    expect(effectiveForCalendarMonth(9000, txnDate, '2026-07', adj)).toBe(3000)
    expect(effectiveForCalendarMonth(9000, txnDate, '2026-08', adj)).toBe(3000)
    expect(effectiveForCalendarMonth(9000, txnDate, '2026-09', adj)).toBe(3000)
    expect(effectiveForCalendarMonth(9000, txnDate, '2026-10', adj)).toBe(0)
    expect(effectiveForCalendarMonth(9000, txnDate, '2026-06', adj)).toBe(0)
  })

  it('calendar: SPLIT only in txn month', () => {
    const txnDate = new Date(2026, 6, 20)
    const adj = { type: 'SPLIT' as const, personalShare: 750 }
    expect(effectiveForCalendarMonth(3000, txnDate, '2026-07', adj)).toBe(750)
    expect(effectiveForCalendarMonth(3000, txnDate, '2026-08', adj)).toBe(0)
  })

  it('formatMonthKey uses local calendar parts', () => {
    expect(formatMonthKey(new Date(2026, 0, 5))).toBe('2026-01')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx jest src/modules/transactions/domain/effective-amount.spec.ts -v
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement helper**

```typescript
export type AdjustmentType = 'SPLIT' | 'EXCLUDE' | 'AMORTIZE'

export type AdjustmentInput = {
  type: AdjustmentType
  personalShare?: number | null
  amortizeMonths?: number | null
}

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function formatMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function effectiveForCycleTxn(amount: number, adjustment: AdjustmentInput | null): number {
  if (!adjustment) return roundMoney(amount)
  if (adjustment.type === 'EXCLUDE') return 0
  if (adjustment.type === 'SPLIT') return roundMoney(Number(adjustment.personalShare ?? 0))
  const n = Number(adjustment.amortizeMonths ?? 0)
  if (n < 2) return roundMoney(amount)
  return roundMoney(amount / n)
}

function addCalendarMonths(year: number, monthIndex: number, delta: number): { y: number; m: number } {
  const idx = year * 12 + monthIndex + delta
  return { y: Math.floor(idx / 12), m: ((idx % 12) + 12) % 12 }
}

export function effectiveForCalendarMonth(
  amount: number,
  txnDate: Date,
  monthKey: string,
  adjustment: AdjustmentInput | null,
): number {
  if (!adjustment) {
    return formatMonthKey(txnDate) === monthKey ? roundMoney(amount) : 0
  }
  if (adjustment.type === 'EXCLUDE') return 0
  if (adjustment.type === 'SPLIT') {
    return formatMonthKey(txnDate) === monthKey ? roundMoney(Number(adjustment.personalShare ?? 0)) : 0
  }
  const n = Number(adjustment.amortizeMonths ?? 0)
  if (n < 2) return 0
  const slice = roundMoney(amount / n)
  const startY = txnDate.getFullYear()
  const startM = txnDate.getMonth()
  for (let i = 0; i < n; i++) {
    const { y, m } = addCalendarMonths(startY, startM, i)
    const key = `${y}-${String(m + 1).padStart(2, '0')}`
    if (key === monthKey) return slice
  }
  return 0
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest src/modules/transactions/domain/effective-amount.spec.ts -v
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/transactions/domain/effective-amount.ts src/modules/transactions/domain/effective-amount.spec.ts
git commit -m "Add Effective Spend amount helper with cycle and calendar rules"
```

---

### Task 3: Adjustment service (upsert / delete)

**Files:**
- Create: `src/modules/transactions/services/transaction-adjustment.service.ts`
- Create: `src/modules/transactions/services/transaction-adjustment.service.spec.ts`
- Create: `src/modules/transactions/presentation/dto/upsert-transaction-adjustment.dto.ts`
- Modify: `src/modules/transactions/transactions.module.ts`

**Interfaces:**
- Consumes: `PrismaService`, `effective-amount` types
- Produces:
  - `TransactionAdjustmentService.upsert(tenantId, actorId, txnId, dto)`
  - `TransactionAdjustmentService.remove(tenantId, txnId)`
  - Response shape: `{ id, transactionId, type, personalShare, amortizeMonths, monthlyAmount, note }`

- [ ] **Step 1: Write DTO**

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator'

export class UpsertTransactionAdjustmentDto {
  @ApiProperty({ enum: ['SPLIT', 'EXCLUDE', 'AMORTIZE'] })
  @IsIn(['SPLIT', 'EXCLUDE', 'AMORTIZE'])
  type!: 'SPLIT' | 'EXCLUDE' | 'AMORTIZE'

  @ApiPropertyOptional()
  @ValidateIf((o) => o.type === 'SPLIT')
  @IsNumber()
  personalShare?: number

  @ApiPropertyOptional()
  @ValidateIf((o) => o.type === 'AMORTIZE')
  @IsInt()
  @Min(2)
  @Max(60)
  amortizeMonths?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}
```

- [ ] **Step 2: Write failing service tests** (mock Prisma)

Cover: txn not found → `NotFoundException`; SPLIT with `personalShare >= amount` → `BadRequestException`; EXCLUDE upsert succeeds; remove missing → `NotFoundException`.

- [ ] **Step 3: Implement service**

Key validation after loading txn:

```typescript
if (dto.type === 'SPLIT') {
  const share = Number(dto.personalShare)
  if (!(share > 0 && share < amount)) {
    throw new BadRequestException('personalShare must be > 0 and < transaction amount')
  }
}
if (dto.type === 'AMORTIZE') {
  const n = Number(dto.amortizeMonths)
  if (!Number.isInteger(n) || n < 2 || n > 60) {
    throw new BadRequestException('amortizeMonths must be an integer between 2 and 60')
  }
}
```

Upsert with `prisma.transactionAdjustment.upsert` on `transactionId`.  
`monthlyAmount` for AMORTIZE = `roundMoney(amount / n)`; else `null`.  
EXCLUDE/SPLIT null out unused fields on write.

- [ ] **Step 4: Register provider in `TransactionsModule`**

- [ ] **Step 5: Run tests**

```bash
npx jest src/modules/transactions/services/transaction-adjustment.service.spec.ts -v
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/transactions/services/transaction-adjustment.service.ts \
  src/modules/transactions/services/transaction-adjustment.service.spec.ts \
  src/modules/transactions/presentation/dto/upsert-transaction-adjustment.dto.ts \
  src/modules/transactions/transactions.module.ts
git commit -m "Add transaction adjustment upsert/delete service"
```

---

### Task 4: Controller endpoints

**Files:**
- Modify: `src/modules/transactions/transactions.controller.ts`

**Interfaces:**
- Consumes: `TransactionAdjustmentService`, `UpsertTransactionAdjustmentDto`
- Produces:
  - `PUT /api/v1/transactions/:id/adjustment`
  - `DELETE /api/v1/transactions/:id/adjustment`

- [ ] **Step 1: Inject service and add routes**

Import `Put` from `@nestjs/common`. Place these handlers **before** generic `@Get(':id')` is fine for method+path specificity; keep path `':id/adjustment'`.

```typescript
@Put(':id/adjustment')
@Roles(Role.ADMIN, Role.USER)
@ApiOperation({ summary: 'Upsert transaction adjustment [AUTH: JWT]' })
async upsertAdjustment(
  @Req() req: ReqUser,
  @Param('id') id: string,
  @Body() dto: UpsertTransactionAdjustmentDto,
) {
  return ok(await this.adjustmentService.upsert(req.user.tenantId, req.user.sub, id, dto))
}

@Delete(':id/adjustment')
@Roles(Role.ADMIN, Role.USER)
@ApiOperation({ summary: 'Delete transaction adjustment [AUTH: JWT]' })
async deleteAdjustment(@Req() req: ReqUser, @Param('id') id: string) {
  await this.adjustmentService.remove(req.user.tenantId, id)
  return ok({ id })
}
```

- [ ] **Step 2: Lint/build**

```bash
npm run lint && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/transactions/transactions.controller.ts
git commit -m "Expose PUT/DELETE transaction adjustment endpoints"
```

---

### Task 5: Card cycle summary Effective fields

**Files:**
- Modify: `src/modules/transactions/services/card-cycle-summary.service.ts`
- Create: `src/modules/transactions/services/card-cycle-summary.service.spec.ts` (unit-test Effective aggregation with mocked prisma)

**Interfaces:**
- Consumes: `effectiveForCycleTxn`, `effectiveForCalendarMonth`, `formatMonthKey`
- Produces per card: `effectiveCycleSpend`, `adjustedAmount`
- Produces totals: `totalEffectiveCycleSpend`, `calendarMonthEffectiveSpend` (current calendar month, all cards)

- [ ] **Step 1: Extend row/response types**

```typescript
effectiveCycleSpend: number
adjustedAmount: number
// response root:
totalEffectiveCycleSpend: number
calendarMonthEffectiveSpend: number
```

- [ ] **Step 2: Replace raw-only aggregate for Effective**

For each card, fetch transactions in the cycle window with `adjustment` included (or fetch amounts+adjustments), then:

```typescript
const cycleSpend = settled.sumAmount // keep existing aggregate for Outstanding
let effectiveCycleSpend = 0
for (const txn of cycleTxns) {
  effectiveCycleSpend += effectiveForCycleTxn(Number(txn.amount), mapAdj(txn.adjustment))
}
effectiveCycleSpend = roundMoney(effectiveCycleSpend)
const adjustedAmount = roundMoney(Math.max(0, cycleSpend - effectiveCycleSpend))
```

Also compute `calendarMonthEffectiveSpend`: for current `formatMonthKey(now)`, for each active card, load txns that could contribute:
- non-AMORTIZE: `txnDate` in calendar month
- AMORTIZE: `txnDate` in `[monthStart - 60 months, monthEnd]` (safe upper bound), then sum `effectiveForCalendarMonth(...)`

Optimize later if needed; correctness first.

- [ ] **Step 3: Tests for AMORTIZE/SPLIT contribution to `effectiveCycleSpend`**

- [ ] **Step 4: Commit**

```bash
git add src/modules/transactions/services/card-cycle-summary.service.ts \
  src/modules/transactions/services/card-cycle-summary.service.spec.ts
git commit -m "Return effectiveCycleSpend on card cycle summary"
```

---

### Task 6: Include adjustment on transaction list

**Files:**
- Modify: `src/infrastructure/repositories/prisma-transaction.repository.ts`
- Modify: `src/modules/transactions/domain/repositories/transaction.repository.ts` (list item shape if needed)
- Modify: `src/modules/transactions/transactions.service.ts` — map list items to include serializable `amount` number + `adjustment`

**Interfaces:**
- Produces list item field:

```typescript
adjustment: {
  type: 'SPLIT' | 'EXCLUDE' | 'AMORTIZE'
  personalShare: number | null
  amortizeMonths: number | null
  monthlyAmount: number | null
  note: string | null
} | null
```

- [ ] **Step 1: `include: { adjustment: true }` on list queries**

- [ ] **Step 2: Map in service/repository so JSON has `amount` as number and nested `adjustment`**

If current serialization already flattens `Money`, keep that path and only attach `adjustment`. Prefer a small `toListItem(row)` mapper next to the repository.

- [ ] **Step 3: Manual smoke or unit test that mapping includes adjustment**

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/repositories/prisma-transaction.repository.ts \
  src/modules/transactions/domain/repositories/transaction.repository.ts \
  src/modules/transactions/transactions.service.ts
git commit -m "Include adjustment payload on transaction list items"
```

---

### Task 7: Frontend API + types

**Files:**
- Modify: `/Users/s0j0b3x/Personal/pft-app/src/lib/apiClient.ts`
- Modify: `/Users/s0j0b3x/Personal/pft-app/src/lib/pftData.ts`
- Modify: `/Users/s0j0b3x/Personal/pft-app/src/types/index.ts`
- Modify: `/Users/s0j0b3x/Personal/pft-app/src/hooks/useExpenses.ts` (or new `useTransactionAdjustment.ts`)

**Interfaces:**
- Produces:
  - `DailyCardExpense.adjustment?: TransactionAdjustmentView | null`
  - `CardCycleSummaryCard.effectiveCycleSpend`, `adjustedAmount`
  - `CardCycleSummary.totalEffectiveCycleSpend`, `calendarMonthEffectiveSpend`
  - `upsertTransactionAdjustment(id, body)`, `deleteTransactionAdjustment(id)`

- [ ] **Step 1: Extend `apiSend` method union with `'PUT'`**

- [ ] **Step 2: Extend types in `types/index.ts`**

```typescript
export type TransactionAdjustmentType = 'SPLIT' | 'EXCLUDE' | 'AMORTIZE'

export type TransactionAdjustmentView = {
  type: TransactionAdjustmentType
  personalShare: number | null
  amortizeMonths: number | null
  monthlyAmount: number | null
  note: string | null
}
```

Add optional `adjustment` on `DailyCardExpense`.

- [ ] **Step 3: Map new fields in `fetchCardCycleSummary` / cursor list mappers in `pftData.ts`**

- [ ] **Step 4: Add upsert/delete helpers using `apiSend(..., 'PUT'|'DELETE', ...)`**

- [ ] **Step 5: Mutation hook invalidates `CARD_CYCLE_SUMMARY_QK`, `['transactions-cursor', dataId]`, and any monthly-plan/dashboard keys already invalidated by expense mutations**

- [ ] **Step 6: Commit in pft-app**

```bash
git add src/lib/apiClient.ts src/lib/pftData.ts src/types/index.ts src/hooks/useExpenses.ts
git commit -m "Add adjustment API client types and mutations"
```

---

### Task 8: Global spend mode switch

**Files:**
- Create: `/Users/s0j0b3x/Personal/pft-app/src/context/SpendModeContext.tsx`
- Modify: app root provider (find where `ThemeProvider` is mounted — typically `src/main.tsx` or `src/App.tsx`)
- Modify: expenses overview / dashboard header area to render the switch

**Interfaces:**
- Produces: `useSpendMode(): { mode: 'outstanding' | 'effective'; setMode }`
- Storage key: `pft-spend-mode`

- [ ] **Step 1: Implement context** (mirror `ThemeContext` localStorage pattern)

Default: `'outstanding'`.

- [ ] **Step 2: Mount provider next to ThemeProvider**

- [ ] **Step 3: Add compact toggle UI** near Wallet / Expenses overview KPIs labeled Outstanding | Effective

- [ ] **Step 4: Commit**

```bash
git add src/context/SpendModeContext.tsx src/main.tsx src/App.tsx \
  src/features/expenses/components/ExpensesOverviewSection.tsx
git commit -m "Add global Outstanding/Effective spend mode switch"
```

---

### Task 9: Bind card amount field + limit check to Effective

**Files:**
- Modify: `/Users/s0j0b3x/Personal/pft-app/src/hooks/useBillingCycle.ts`
- Modify: `/Users/s0j0b3x/Personal/pft-app/src/features/dashboard/components/CreditCardStackCard.tsx`
- Modify: `/Users/s0j0b3x/Personal/pft-app/src/features/dashboard/components/WalletCard.tsx`
- Modify: `/Users/s0j0b3x/Personal/pft-app/src/features/expenses/components/useExpensesPageState.ts`
- Modify: `/Users/s0j0b3x/Personal/pft-app/src/features/expenses/components/ExpensesOverviewSection.tsx`

**Interfaces:**
- Display amount = `mode === 'effective' ? effectiveCycleSpend : cycleSpend`
- Trend / statement still use Outstanding (`cycleSpend` vs `statementTotal`)
- Limit util:

```typescript
const spendForLimit = cardCycleSummary?.calendarMonthEffectiveSpend ?? 0
const cycleUtilPct = basicExpenses > 0
  ? Math.min(100, Math.round((spendForLimit / cycleLimit) * 100))
  : 0
```

KPI label for limit tone uses Effective always; the toggled “This cycle spend” KPI uses mode-aware total (`totalCycleSpend` vs `totalEffectiveCycleSpend`).

- [ ] **Step 1: Expose both totals from `useBillingCycle`**

- [ ] **Step 2: Pass mode-selected amount into `WalletCard` `cycleSpend` prop (or rename prop to `displaySpend` if low-churn)**

Prefer keeping prop name `cycleSpend` but pass the switched value from parent to minimize file churn; document in comment that parent applies mode.

- [ ] **Step 3: Wire Variable Spend Limit util to `calendarMonthEffectiveSpend`**

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useBillingCycle.ts \
  src/features/dashboard/components/CreditCardStackCard.tsx \
  src/features/dashboard/components/WalletCard.tsx \
  src/features/expenses/components/useExpensesPageState.ts \
  src/features/expenses/components/ExpensesOverviewSection.tsx
git commit -m "Bind card spend display switch and Effective limit utilization"
```

---

### Task 10: ExpenseRow badges + adjust UI

**Files:**
- Modify: `/Users/s0j0b3x/Personal/pft-app/src/features/expenses/components/ExpenseRow.tsx`
- Modify: `/Users/s0j0b3x/Personal/pft-app/src/features/expenses/components/ExpensesTransactionsSection.tsx`
- Create: `/Users/s0j0b3x/Personal/pft-app/src/features/expenses/components/AdjustTransactionSheet.tsx`

**Interfaces:**
- Badge table from spec: Split / Excluded / Spread
- Sheet actions: Split (share input), Exclude, Spread (months default 12), Clear
- Primary row amount remains bank `amount`

- [ ] **Step 1: Render badge + secondary text when `expense.adjustment` present**

- [ ] **Step 2: Add row action opening `AdjustTransactionSheet`**

Pre-fill from existing adjustment; submit calls upsert mutation; Clear calls delete mutation.

- [ ] **Step 3: Validate client-side: SPLIT share in `(0, amount)`; AMORTIZE months in `2..60`**

- [ ] **Step 4: Commit**

```bash
git add src/features/expenses/components/ExpenseRow.tsx \
  src/features/expenses/components/ExpensesTransactionsSection.tsx \
  src/features/expenses/components/AdjustTransactionSheet.tsx
git commit -m "Add transaction adjustment badges and adjust sheet UI"
```

---

### Task 11: End-to-end validation + docs rename

**Files:**
- Modify: rename design/plan TODO → DONE when feature ships (optional final step)

- [ ] **Step 1: Backend validation**

```bash
cd /Users/s0j0b3x/Personal/pft-backend && npm run lint && npm run build && npm test
```

- [ ] **Step 2: Frontend validation**

```bash
cd /Users/s0j0b3x/Personal/pft-app && npm run build
```

- [ ] **Step 3: Manual checklist**

1. Create SPLIT on a txn → Effective card amount drops; Outstanding unchanged in Outstanding mode.
2. Toggle switch → same field flips between totals.
3. AMORTIZE 12 on ₹12,000 → cycle Effective +₹1,000; `calendarMonthEffectiveSpend` includes ₹1,000; next calendar month still includes ₹1,000 after month rolls (or simulate via date helper test).
4. EXCLUDE → Effective 0 for that txn.
5. Clear adjustment → restores.
6. Variable Spend Limit tone uses Effective even when switch is Outstanding.
7. Sync-pending unsettled unchanged.

- [ ] **Step 4: Rename docs when complete**

```bash
git mv docs/TODO-transaction-adjustments-design.md docs/DONE-transaction-adjustments-design.md
git mv docs/TODO-transaction-adjustments-plan.md docs/DONE-transaction-adjustments-plan.md
git commit -m "Mark transaction adjustments design and plan as DONE"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `TransactionAdjustment` model | 1 |
| Effective formulas (cycle + calendar) | 2 |
| PUT/DELETE adjustment + validation | 3–4 |
| `effectiveCycleSpend` / totals on summary | 5 |
| `adjustment` on list items | 6 |
| Frontend API + mutations | 7 |
| Global switch + localStorage | 8 |
| Same amount field toggled | 9 |
| Monthly Plan limit always Effective | 9 (`calendarMonthEffectiveSpend`) |
| Badges + adjust/edit/clear UI | 10 |
| Outstanding unchanged for unsettled/trend | 5, 9 (no code changes to those paths) |
| AMORTIZE months-only | 2–3, 10 |

## Placeholder / consistency self-review

- No TBD steps; AMORTIZE monthly override rejected (spec A).
- `calendarMonthEffectiveSpend` is the explicit bridge for “Monthly Plan CC budget always Effective” because live limit UI uses card-cycle-summary today (`useExpensesPageState`), not `MonthlyPlan.basicCcSpent`.
- Names aligned: `effectiveCycleSpend`, `totalEffectiveCycleSpend`, `calendarMonthEffectiveSpend`, `adjustedAmount`.
