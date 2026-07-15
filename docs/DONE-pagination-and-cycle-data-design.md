# Pagination & Cycle Data API Design

Design decisions for transaction list pagination and the new cycle-data aggregation endpoint.

## Problem Statement

The frontend currently fetches all transactions in one call (`pageSize=1000`) and computes
billing cycle totals, card summaries, and filters entirely client-side. This does not scale
and couples the summary section's re-render lifecycle to the transaction list.

### CC Billing Cycle Caveat

Each credit card has its own `statementCycleDay` (1-31). The "current cycle" window differs
per card. Computing cycle totals requires at minimum a full month of transaction data per card.
Naively paginating the transaction list breaks cycle total accuracy.

## Architecture Decision

Separate the **card summary** concern from the **transaction list** concern at the API level:

| Concern | Endpoint | Pagination? |
|---------|----------|-------------|
| Card summaries (cycle spend, statement, trend) | `GET /transactions/cycle-data` | No — always complete |
| Transaction list | `GET /transactions` (cursor-based) | Yes — infinite scroll |

The two endpoints have independent React Query cache keys. Paginating the list never
causes the summary section to re-render.

---

## Endpoint 1: `GET /api/v1/transactions/cycle-data`

Returns all pre-computed/derived values the wallet card summary section needs.
The frontend just renders — no calculation required.

### Request

```
GET /api/v1/transactions/cycle-data
Authorization: Bearer <jwt>
```

No query params. Computes for all active cards of the authenticated tenant.

### Response

```json
{
  "data": {
    "totalCycleSpend": 20700,
    "totalStatementDues": 45200,
    "totalUnsettled": 3800,

    "cards": [
      {
        "cardId": "clxyz123...",
        "cardKey": "HDFC_REGALIA",

        "cycleSpend": 12500,
        "cycleStart": "2026-06-17",
        "cycleEnd": "2026-07-16",
        "txnCount": 42,

        "statementTotal": 22000,
        "minDue": 1100,
        "status": "unpaid",
        "dueDate": "2026-07-25",
        "statementSyncMonth": "2026-06",

        "statementSyncPending": false,
        "missingLatestStatement": false,
        "canManualUpdate": false,

        "unsettledAmount": 0,

        "trend": {
          "pct": -43.2,
          "direction": "down"
        }
      }
    ]
  }
}
```

### Field Definitions

| Field | Type | Computed from |
|-------|------|---------------|
| `totalCycleSpend` | number | Sum of all cards' `cycleSpend` |
| `totalStatementDues` | number | Sum of all latest bills' `totalAmountDue` |
| `totalUnsettled` | number | Sum of unsettled amounts across cards with stale sync |
| `cards[].cycleSpend` | number | Sum of transactions in this card's billing cycle window |
| `cards[].cycleStart` | date string | Start of cycle (from `statementCycleDay` + widen logic) |
| `cards[].cycleEnd` | date string | End of cycle (today + 1 day, exclusive) |
| `cards[].txnCount` | number | Count of transactions in cycle window |
| `cards[].statementTotal` | number | If sync pending: unsettled amount; else: latest bill `totalAmountDue` |
| `cards[].minDue` | number | From latest bill `minimumAmountDue` |
| `cards[].status` | string | From latest bill status (e.g. "paid", "unpaid") |
| `cards[].dueDate` | string or null | From latest bill due date |
| `cards[].statementSyncMonth` | string or null | From latest bill `statementSyncMonth` (YYYY-MM) |
| `cards[].statementSyncPending` | boolean | `today >= cycleDay && syncMonth < currentMonth` |
| `cards[].missingLatestStatement` | boolean | No bill found for this card |
| `cards[].canManualUpdate` | boolean | `!bill \|\| statementSyncPending` |
| `cards[].unsettledAmount` | number | Widened cycle spend minus current cycle spend (stale sync only) |
| `cards[].trend.pct` | number or null | `(cycleSpend - statementTotal) / statementTotal * 100` |
| `cards[].trend.direction` | string | `"up"` / `"down"` / `"flat"` / `"none"` |

### Backend Computation Steps

1. Fetch all active cards for tenant (with `statementCycleDay`)
2. Fetch all latest bills for tenant
3. For each card:
   - Resolve cycle day: bill's `statementCycle` > card's `statementCycleDay` > default 17
   - Determine if sync is stale (`shouldWidenCycleSpendFromSyncMonth`)
   - Compute cycle window (`getBillingWindowForCardSpend` equivalent)
   - Query transactions within that window (date-range + cardId)
   - Sum amounts, count transactions
   - If stale sync: also compute widened window and derive `unsettledAmount`
   - Compute trend vs `statementTotal`
4. Aggregate totals across all cards

---

## Endpoint 2: `GET /api/v1/transactions` (cursor-based)

Paginated transaction list with infinite scroll support.

### Request

```
GET /api/v1/transactions?limit=20&cursor=abc123&cardId=xyz&fromDate=2026-06-17&toDate=2026-07-15&q=amazon
Authorization: Bearer <jwt>
```

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `limit` | int | No | 20 | Items per page (max 100) |
| `cursor` | string | No | — | Opaque cursor from previous response. Omit for first page. |
| `cardId` | string | No | — | Filter by card ID |
| `fromDate` | string (YYYY-MM-DD) | No | — | Transactions on or after this date |
| `toDate` | string (YYYY-MM-DD) | No | — | Transactions on or before this date |
| `q` | string | No | — | Merchant name search (case-insensitive substring) |

### Response

```json
{
  "data": {
    "items": [
      {
        "id": "txn_abc123",
        "cardId": "clxyz123...",
        "txnDate": "2026-07-14",
        "txnTimestamp": "2026-07-14T13:09:19.000Z",
        "amount": 1500,
        "merchant": "Amazon",
        "channel": "ONLINE",
        "referenceNo": "REF123456"
      }
    ],
    "nextCursor": "txn_ghi789",
    "hasMore": true,
    "total": 847
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `items` | array | Transaction objects for this page |
| `nextCursor` | string or null | Pass as `cursor` for next page. `null` = end of list. |
| `hasMore` | boolean | `true` if more pages exist |
| `total` | number | Total matching transactions (for "showing X of Y") |

### Cursor Strategy

Encodes sort position: `txnTimestamp DESC, id DESC`.
Backend decodes to: `WHERE (txnTimestamp, id) < (cursorTimestamp, cursorId)`.

Guarantees:
- Stable pagination even if new transactions arrive
- No duplicates or skipped items
- Opaque to frontend (just pass it back)

### Backward Compatibility

Existing `page`/`pageSize` params remain supported. If `cursor` is provided, cursor-based
pagination is used. If `page` is provided, offset-based fallback. Allows gradual migration.

---

## Frontend Data Flow

### Shared across pages

`GET /transactions/cycle-data` uses a single React Query cache key (`cycleSummaryQK`).
Both Dashboard and Wallet pages consume the same cached data — navigating between them
within `staleTime` (5 min) triggers zero re-fetch.

### Dashboard page

```
GET /transactions/cycle-data  →  React Query: cycleSummaryQK
  ├── CreditCardStackCard (per-card: cycleSpend, trend, status, dueDate...)
  └── ExpensesOverviewSection (KPIs: totalCycleSpend, totalStatementDues) [if shown]

GET /transactions?limit=3  →  React Query: recentTxnQK
  └── CreditCardStackCard "Recent transactions" section (top 3)
```

### Wallet/Expenses page — Cycle mode (page load default)

```
GET /transactions/cycle-data  →  React Query: cycleSummaryQK (shared, may be cached)
  ├── ExpensesOverviewSection (KPIs: totalCycleSpend, totalStatementDues)
  └── CreditCardStackCard (per-card: cycleSpend, trend, status, dueDate...)

GET /transactions?fromDate=<earliest cycleStart>&toDate=<today>&limit=20&cursor=...
  └── ExpensesTransactionsSection (infinite scroll, cycle-filtered)
```

Frontend computes `fromDate` from card metadata (`statementCycleDay` via `GET /cards`).

### Wallet/Expenses page — All mode (user toggles off cycle filter)

```
GET /transactions?limit=20&cursor=...
  └── ExpensesTransactionsSection (infinite scroll, no date filter)
```

### Filtering

Filtering uses the **same** `GET /transactions` endpoint — no separate filter endpoint.
Filters are query params that compose with pagination. When any filter changes, the cursor
resets to the beginning (new result set).

| Filter | Cycle mode | All mode |
|--------|-----------|----------|
| Card dropdown | `&cardId=clxyz123` | `&cardId=clxyz123` |
| Merchant search | `&q=swiggy` (server-side) | `&q=swiggy` (server-side) |
| Period toggle | Adds `&fromDate=...&toDate=...` | Removes date params |
| Combined | All params compose | All params compose |

#### Example Calls

**No filters, all history (default "all" mode):**
```
GET /transactions?limit=20
GET /transactions?limit=20&cursor=txn_abc123   (next page)
```

**Cycle mode (frontend derives dates from card metadata):**
```
GET /transactions?limit=20&fromDate=2026-06-17&toDate=2026-07-15
```

**Cycle mode + card filter:**
```
GET /transactions?limit=20&fromDate=2026-06-22&toDate=2026-07-15&cardId=clxyz456
```

**All mode + merchant search:**
```
GET /transactions?limit=20&q=amazon
GET /transactions?limit=20&q=amazon&cursor=txn_def456   (next page)
```

**All mode + card filter + search (fully composed):**
```
GET /transactions?limit=20&cardId=clxyz123&q=swiggy
```

#### Filter Behavior Rules

1. **Cursor resets on filter change** — when user changes card/search/period, frontend
   discards the current cursor and fetches page 1 of the new filtered set.
2. **`total` reflects filtered count** — response `total` is the count matching all
   active filters, not the global count.
3. **Empty `q` is ignored** — backend treats missing or empty `q` as "no search filter".
4. **`fromDate`/`toDate` are inclusive** — transactions on `fromDate` and `toDate` are
   included in results.
5. **Filters compose with AND** — `cardId=X&q=Y&fromDate=Z` means: card X AND merchant
   matches Y AND date >= Z.

---

## Caching Strategy

### Recommended: Frontend-only caching (start here)

React Query `staleTime: 5 * 60_000` for `cycleSummaryQK`. Backend computes fresh on each
request. At current scale (< 100 txns/card/month, 2-5 cards), computation is 50-150ms —
acceptable without backend caching.

After write mutations (add/delete transaction, create statement, mark paid, etc.),
frontend calls `queryClient.invalidateQueries(['cycle-data'])` to re-fetch.

### Future: Redis cache with event invalidation

If needed at scale:

```
Cache key:    cycle-data:{tenantId}
TTL:          5 minutes (safety net for day-boundary)
Invalidate:   delete key on write events
```

### Cache Invalidation Events

| Event | Trigger point | Why it invalidates |
|-------|---------------|-------------------|
| Transaction created | `POST /transactions` | cycleSpend, txnCount, totalCycleSpend, trend |
| Transaction deleted | `DELETE /transactions/:id` | Same as above |
| Statement synced (Gmail) | Statement sync job completes | statementTotal, minDue, dueDate, status, syncPending, trend |
| Manual statement created | `POST /statements` | Same as statement sync |
| Bill marked as paid | `PATCH /latest-bills/:id/status` | status |
| Card created | `POST /cards` | New card in response |
| Card deleted/closed | `DELETE /cards/:id` | Card removed from response |
| Card edited (cycleDay) | `PATCH /cards/:id` | Cycle window shifts, all values for that card |
| Day rolls over (midnight) | TTL expiry (no explicit event) | cycleEnd shifts, syncPending may flip |

---

## What Each Endpoint Owns

| Data | Source endpoint | Notes |
|------|----------------|-------|
| Card cosmetics (label, color, variant, cvv, expiry) | `GET /cards` | Static metadata |
| Computed cycle aggregates | `GET /transactions/cycle-data` | This new endpoint |
| Paginated transaction rows | `GET /transactions` (cursor) | Revised existing endpoint |
| Latest bills raw data | `GET /latest-bills` | May be deprecated if cycle-data covers all needs |

---

## Performance Impact

### Current bottlenecks

| Bottleneck | Impact | Where |
|---|---|---|
| Fetching 1000 transactions in one call | Slow initial load, large JSON parse (~200-500KB) | Network + main thread |
| `useMemo` computing cycle totals over 1000 items | Blocks render on every dependency change | Main thread |
| `useMemo` filtering/sorting 1000 items on every filter change | Janky filter interactions | Main thread |
| Rendering all transaction rows into DOM at once | Large DOM, slow paint, scroll jank | Rendering |
| Summary + list share same data source | Summary re-derives/re-renders when list data changes | React reconciliation |

### What this implementation fixes

| Metric | Before | After | Improvement |
|---|---|---|---|
| Initial network payload | ~1000 items, 200-500KB | cycle-data (~2KB) + 20 items (~10KB) | ~95% smaller |
| Time to first paint | Wait for full dataset + all computations | Two small parallel fetches, render immediately | ~1-2s → ~200-400ms |
| Cycle computation on client | `useMemo` over 1000 txns on every cards/bills change | Backend returns pre-computed values, zero client math | Eliminated |
| Filter/sort recomputation | Re-processes 1000 items in useMemo | Cursor resets, server returns 20 new items | Eliminated |
| DOM node count | All transactions rendered (~100-500 nodes) | Only loaded pages in DOM (~20-60 nodes per page) | ~80% reduction initially |
| Summary section re-renders | Shares query key with list, re-renders on every change | Independent query key, never touched by pagination | Eliminated |

### What remains (future improvements)

| Issue | Why it persists | Recommended solution |
|---|---|---|
| Growing DOM as user scrolls deep | Infinite scroll appends pages, old items stay in DOM | Virtual scrolling (tanstack-virtual) — only render visible rows |
| Network latency per "load more" | User sees spinner while next 20 items arrive (~100-200ms) | Prefetch next page when scroll reaches 70% of loaded content |
| Rapid filter toggling = many API calls | Each filter change fires a new fetch | Debounce search input (300ms); abort in-flight requests on filter change |

### Net UX improvement estimates

For typical usage (2-5 cards, < 100 txns/month):

| Interaction | Current latency | Expected latency | Notes |
|---|---|---|---|
| Page open → interactive | ~1-2s | ~200-400ms | Smaller payload + no client-side compute |
| Filter by card | ~50-150ms recompute + full list re-render | ~200ms fetch + 20 items render | Server-side filter, minimal render |
| Toggle cycle/all | ~50-150ms recompute + full list re-render | ~200ms fetch + 20 items render | Date-range filter server-side |
| Merchant search (all mode) | ~30-50ms client filter + full re-render | ~200-300ms fetch (debounced) + 20 items render | Server-side, but adds network round-trip |
| Scrolling through list | Jank if DOM has 100+ rows | Smooth — only 20-60 nodes | Biggest perceived improvement |
| Card summary during scroll | May flicker/recompute | Rock-stable, independent query | No coupling to list activity |

---

## Key Design Decisions

1. **Separate summary from list** — prevents pagination from re-rendering card summaries.
2. **Backend computes cycle windows** — frontend doesn't need to load all transactions.
3. **Cursor-based pagination** — stable under inserts, natural for infinite scroll.
4. **No backend cache initially** — frontend staleTime is sufficient at current scale.
5. **Frontend handles cycle date-range for list** — uses card metadata to derive `fromDate`, keeps the transactions endpoint stateless.
6. **Cycle-data returns only computed values** — no cosmetic card attributes, no raw transaction list.
