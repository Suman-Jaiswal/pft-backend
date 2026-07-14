# Transaction Categorization — Architecture Design

Feature to automatically and manually categorize credit card transactions into spending
categories (Food, Shopping, Transport, etc.) for insights, budgets, and breakdowns.

## Problem Statement

Transactions currently have no category. The app cannot show spending breakdowns,
category-wise trends, or budget tracking. A `CategoryHeatGridCard` placeholder exists
in the frontend but has no backing data.

## Architecture Overview

Categorization is a **multi-tier pipeline**. Each tier handles what it's best at:

```
Transaction arrives
       │
       ▼
┌──────────────┐     covers ~75-80%
│  Tier 1      │     instant, free, deterministic
│  Rule Engine │─────────────────────────────┐
└──────┬───────┘                             │
       │ unmatched                           │
       ▼                                     │
┌──────────────┐     covers ~10-15%          │
│  Tier 2      │     pattern recognition     │
│  Heuristics  │─────────────────────────┐   │
└──────┬───────┘                         │   │
       │ still unknown                   │   │
       ▼                                 │   │
┌──────────────┐     covers ~5-10%       │   │
│  Tier 3      │     batch, async        │   │
│  LLM Classify│─────────────────────┐   │   │
└──────┬───────┘                     │   │   │
       │                             ▼   ▼   ▼
       ▼                      ┌────────────────────┐
┌──────────────┐              │  categoryId saved  │
│  Uncategorized│             │  on Transaction    │
│  (user fixes)│──────────────┤                    │
└──────────────┘              └────────────────────┘
       │ user correction
       ▼
┌──────────────┐
│  Tier 4      │
│  Feedback    │──── creates/updates Tier 1 rule for this user
│  Loop        │
└──────────────┘
```

---

## Tier 1: Merchant-to-Category Rule Engine

The workhorse. A lookup table mapping merchant patterns to categories.

### Two scopes

- **System rules** — curated defaults for known Indian merchants (Swiggy, Amazon, Uber, etc.)
- **Tenant rules** — user-specific overrides ("for me, Amazon = Groceries")

### Matching strategy (checked in order)

1. Exact match (normalized, case-insensitive): `"SWIGGY"` → Food
2. Prefix/contains match: `"AMAZON*"` → Shopping, `"*FUEL*"` → Transport
3. Regex for complex patterns: `"^(UBER|OLA|RAPIDO)"` → Transport

### Priority

Tenant rule > System rule. More specific > less specific.

### Coverage

A curated seed set of ~200 merchant patterns covers 75-80% of typical Indian consumer
spending. CC transaction merchant names from Indian banks are fairly consistent.

---

## Tier 2: Heuristics (Channel + Amount patterns)

For transactions where the merchant name is generic but other signals help.

| Signal | Heuristic | Category |
|--------|-----------|----------|
| `channel = "ATM"` | Cash withdrawal | Cash/ATM |
| `channel = "EMI"` | Loan installment | EMI/Loans |
| Recurring same merchant + same amount monthly | Subscription detection | Subscriptions |
| Merchant contains "IRCTC" or "MAKEMYTRIP" | Travel booking | Travel |
| Amount matches known utility ranges + known billers | Bill payment | Bills & Utilities |

---

## Tier 3: LLM Classification (batch, async)

For the 5-10% the rule engine can't handle.

### When

After Tier 1+2 leave a transaction as "Uncategorized".

### How

Batch job (not real-time). Collect uncategorized transactions, send to LLM in batches
of 20-50.

### Input to LLM

```json
{
  "merchant": "RARE RABBIT BANGALORE",
  "amount": 4500,
  "channel": "POS",
  "availableCategories": ["Food & Dining", "Shopping", "Transport", ...]
}
```

### Output

```json
{ "category": "Shopping", "subcategory": "Fashion", "confidence": 0.92 }
```

### Cost control

- Only unclassified transactions (not all)
- Run once per unique merchant (cache result as a system rule for future)
- Batch reduces API calls
- At < 100 txns/month with 80% covered by rules, LLM classifies ~10-20 per month

---

## Tier 4: User Feedback Loop

When a user manually changes a category:

1. Save the override on the transaction (`categorySource = 'MANUAL'`)
2. Prompt: "Always categorize [merchant] as [category]?"
   - Yes → create a tenant-level rule in Tier 1
   - No → one-off override, no rule created
3. If rule created: re-categorize other uncategorized transactions from same merchant

This makes the system learn per user without ML — just rule creation from corrections.

---

## Category Taxonomy

Flat categories with optional grouping (not deep hierarchy):

| Category | Icon | Typical merchants |
|----------|------|-------------------|
| Food & Dining | utensils | Swiggy, Zomato, restaurants, cafes |
| Groceries | shopping-cart | BigBasket, Blinkit, DMart, Zepto |
| Shopping | bag | Amazon, Flipkart, Myntra, malls |
| Transport | car | Uber, Ola, Rapido, fuel stations |
| Bills & Utilities | zap | Electricity, internet, mobile, water |
| Entertainment | film | Netflix, Hotstar, PVR, Spotify |
| Health & Fitness | heart | Pharmacies, hospitals, gyms |
| Travel | plane | Flights, hotels, MakeMyTrip, IRCTC |
| Subscriptions | repeat | Auto-detected recurring payments |
| Education | book | Courses, coaching, books |
| EMI/Loans | landmark | EMI debits, loan payments |
| Cash/ATM | banknote | ATM withdrawals |
| Transfers | arrow-right-left | P2P, wallet loads |
| Other | circle-dot | Uncategorized fallback |

Users can create custom categories but cannot delete system ones (only hide them).

---

## Data Model

### New models

```prisma
model Category {
  id        String   @id @default(cuid())
  name      String
  slug      String
  icon      String
  color     String
  parentId  String?
  scope     String   // 'SYSTEM' | 'TENANT'
  tenantId  String?  // null for system categories
  sortOrder Int      @default(0)
  isHidden  Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  parent        Category?              @relation("CategoryHierarchy", fields: [parentId], references: [id])
  children      Category[]             @relation("CategoryHierarchy")
  transactions  Transaction[]
  rules         MerchantCategoryRule[]

  @@unique([tenantId, slug])
}

model MerchantCategoryRule {
  id          String   @id @default(cuid())
  tenantId    String?  // null = system-wide rule
  pattern     String   // merchant match pattern
  matchType   String   // 'EXACT' | 'PREFIX' | 'CONTAINS' | 'REGEX'
  categoryId  String
  priority    Int      @default(0)  // higher = checked first
  source      String   // 'SYSTEM_SEED' | 'LLM_LEARNED' | 'USER_CORRECTION'
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  category Category @relation(fields: [categoryId], references: [id])

  @@index([tenantId, pattern])
}
```

### Transaction model additions

```prisma
model Transaction {
  // ... existing fields ...
  categoryId         String?
  categorySource     String?   // 'RULE' | 'HEURISTIC' | 'LLM' | 'MANUAL'
  categoryConfidence Float?    // 0.0 - 1.0 (null for rule/manual)
  emailSubject       String?   // stored on import for traceability
  emailBody          String?   // plain text (HTML stripped), stored on import

  category Category? @relation(fields: [categoryId], references: [id])
}
```

---

## Processing Pipeline

### On Transaction Create/Import (synchronous)

1. **Save email trace** — store `message.subject` and `message.body` on the transaction
   (`emailSubject`, `emailBody` fields). This is the raw source for re-processing.
2. Normalize merchant name (uppercase, trim, known aliases)
3. Check tenant rules (exact → prefix → contains → regex)
4. Check system rules (exact → prefix → contains → regex)
5. Apply heuristics (channel-based, pattern-based)
6. If match found → set `categoryId`, `categorySource`, `confidence=1.0`
7. If no match → leave `categoryId=null`, queue for LLM batch

### Batch Job (hourly or on-demand)

1. Collect uncategorized transactions (`categoryId IS NULL`)
2. Group by unique normalized merchant name (deduplicate)
3. Send batch to LLM — include `merchant`, `amount`, `channel`, `emailBody` from DB
   (no Gmail API call needed — body is stored)
4. For each result:
   - Update all transactions for that merchant
   - Create system rule (`source='LLM_LEARNED'`)
   - Future transactions auto-match via Tier 1

### On User Category Correction

1. Update transaction: `categoryId`, `categorySource='MANUAL'`
2. Prompt: "Always use this for [merchant]?"
   - Yes: create tenant rule (`source='USER_CORRECTION'`)
   - No: one-off, no rule
3. If rule created: re-categorize other uncategorized transactions from same merchant

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /categories` | GET | List all categories (system + tenant custom) |
| `POST /categories` | POST | Create custom tenant category |
| `PATCH /categories/:id` | PATCH | Hide/rename/reorder a category |
| `PATCH /transactions/:id/category` | PATCH | Manual category assignment |
| `POST /transactions/categorize` | POST | Trigger batch re-categorization |
| `GET /transactions/category-breakdown` | GET | Aggregated spend by category (for charts) |
| `GET /merchant-rules` | GET | List tenant's custom rules |
| `POST /merchant-rules` | POST | Create manual merchant→category rule |

---

## Category Breakdown Endpoint

Powers the dashboard charts (`CategoryHeatGridCard` and future insights).

### Request

```
GET /api/v1/transactions/category-breakdown?period=cycle
GET /api/v1/transactions/category-breakdown?fromDate=2026-06-01&toDate=2026-06-30
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | string | — | `"cycle"` uses current billing cycle window |
| `fromDate` | date | — | Custom date range start |
| `toDate` | date | — | Custom date range end |
| `cardId` | string | — | Filter by card |

### Response

```json
{
  "data": {
    "period": { "start": "2026-06-17", "end": "2026-07-15" },
    "totalSpend": 20700,
    "breakdown": [
      {
        "categoryId": "...",
        "slug": "food-dining",
        "name": "Food & Dining",
        "icon": "utensils",
        "color": "#F59E0B",
        "amount": 8200,
        "pct": 39.6,
        "txnCount": 24
      },
      {
        "categoryId": "...",
        "slug": "shopping",
        "name": "Shopping",
        "icon": "bag",
        "color": "#8B5CF6",
        "amount": 5400,
        "pct": 26.1,
        "txnCount": 8
      }
    ],
    "uncategorized": { "amount": 1200, "txnCount": 3 }
  }
}
```

---

## Integration with Existing Systems

### Transaction list (paginated endpoint)

The paginated `GET /transactions` response includes `categoryId` per item. Frontend
renders a category chip (color-coded, tappable to change) on each `ExpenseRow`.

### Cycle-data endpoint

The `GET /transactions/cycle-data` can optionally include top categories per card:

```json
{
  "cards": [{
    "cardId": "...",
    "cycleSpend": 12500,
    "topCategories": [
      { "slug": "food-dining", "amount": 5200 },
      { "slug": "shopping", "amount": 3800 }
    ]
  }]
}
```

### Dashboard

`CategoryHeatGridCard` consumes `GET /transactions/category-breakdown?period=cycle`
to show weekly spend broken down by category.

---

## Key Finding: CC Alert Merchant Text Already Differentiates Sub-Services

Tested against actual HDFC CC alerts. The merchant text parsed from bank emails already
includes sub-service identifiers:

| Raw merchant text | Service | Category |
|---|---|---|
| `RSP*SWIGGY` | Swiggy Food | Food & Dining |
| `RSP*INSTAMART` | Swiggy Instamart | Groceries |
| `PTM*SWIGGY IN` | Swiggy via Paytm | Food & Dining |
| `WWW SWIGGY COM` | Swiggy web | Food & Dining |
| `CLEARTRIP PRIVATE LIMI` | Cleartrip | Travel |

Prefixes are payment processor codes: `RSP*` = Razorpay, `PTM*` = Paytm.

### Implication

**No order email correlation needed.** The existing `merchant` field from CC alert parsing
has enough signal to distinguish sub-services (Swiggy Food vs Instamart, etc.). The rule
engine with CONTAINS matching handles this directly.

### Card parser quality status

| Card | Merchant text quality | Rule engine coverage |
|---|---|---|
| HDFC | Good — includes sub-service identifiers | ~90%+ |
| SBI | Good — similar differentiation | ~90%+ |
| ICICI | Generic/inconsistent — parser fix needed | Lower (TODO: fix parser) |

**ICICI parser improvement is a prerequisite** for full categorization coverage. Until fixed,
ICICI transactions may need LLM fallback or manual correction more often.

---

## Seed Data Strategy

### Rule matching priority for multi-service merchants

Order matters. More specific rules (CONTAINS "INSTAMART") must be checked before broader
rules (CONTAINS "SWIGGY"). Enforce via `priority` field:

```
priority=100: CONTAINS "INSTAMART"        → Groceries
priority=90:  CONTAINS "BLINKIT"          → Groceries
priority=50:  CONTAINS "SWIGGY"           → Food & Dining   (catches remaining)
priority=50:  CONTAINS "ZOMATO"           → Food & Dining   (catches remaining)
```

### Phase 1: Curated merchant rules (~200 patterns)

Cover the most common Indian CC merchants. Rules use CONTAINS matching on the normalized
merchant text (uppercase, trimmed).

| Pattern | Match type | Priority | Category |
|---------|-----------|----------|----------|
| `INSTAMART` | CONTAINS | 100 | Groceries |
| `BLINKIT` | CONTAINS | 100 | Groceries |
| `BIGBASKET` | CONTAINS | 90 | Groceries |
| `ZEPTO` | CONTAINS | 90 | Groceries |
| `SWIGGY` | CONTAINS | 50 | Food & Dining |
| `ZOMATO` | CONTAINS | 50 | Food & Dining |
| `AMAZON FRESH` | CONTAINS | 100 | Groceries |
| `AMAZON PANTRY` | CONTAINS | 100 | Groceries |
| `AMAZON` | CONTAINS | 50 | Shopping |
| `AMZN` | CONTAINS | 50 | Shopping |
| `FLIPKART` | CONTAINS | 50 | Shopping |
| `MYNTRA` | CONTAINS | 50 | Shopping |
| `UBER` | CONTAINS | 50 | Transport |
| `OLA` | CONTAINS | 50 | Transport |
| `RAPIDO` | CONTAINS | 50 | Transport |
| `CLEARTRIP` | CONTAINS | 50 | Travel |
| `MAKEMYTRIP` | CONTAINS | 50 | Travel |
| `IRCTC` | CONTAINS | 50 | Travel |
| `YATRA` | CONTAINS | 50 | Travel |
| `NETFLIX` | CONTAINS | 50 | Entertainment |
| `HOTSTAR` | CONTAINS | 50 | Entertainment |
| `SPOTIFY` | CONTAINS | 50 | Entertainment |
| `PRIME VIDEO` | CONTAINS | 50 | Entertainment |
| `PHARMACY` | CONTAINS | 50 | Health & Fitness |
| `APOLLO` | CONTAINS | 50 | Health & Fitness |
| `1MG` | CONTAINS | 50 | Health & Fitness |
| `FUEL` | CONTAINS | 50 | Transport |
| `PETROL` | CONTAINS | 50 | Transport |
| `HPCL` | CONTAINS | 50 | Transport |
| `BPCL` | CONTAINS | 50 | Transport |
| `IOCL` | CONTAINS | 50 | Transport |
| ... | ... | ... | ... |

Store as a seed migration or JSON fixture loaded on first run.

### Phase 2: LLM backfill

After launch, run the LLM batch job on remaining uncategorized transactions.
Each LLM result creates a system rule — future matching is instant.

---

## Email Body Storage (Trace)

### Why store email body on Transaction

The `emailBody` and `emailSubject` fields are saved at import time. The email body is
already fetched and parsed — just not persisted currently. Storing it provides:

| Benefit | How it helps |
|---------|--------------|
| **LLM without Gmail API** | Batch job reads `emailBody` from DB — no re-fetch needed |
| **Parser re-runs** | If parser improves, re-process stored bodies without Gmail access |
| **Format change recovery** | Bank changes template → write new regex, test against stored bodies in bulk |
| **Rule discovery** | Query: `SELECT emailBody FROM transaction WHERE categoryId IS NULL` → spot new patterns |
| **Audit/debugging** | Verify what parser extracted vs what email actually said |
| **Gmail independence** | Token expires, email deleted, label changes — historical data safe in DB |

### Storage cost

- ~500-2000 chars per email (plain text, HTML stripped)
- 100 txns/month = ~100-200KB/month
- 1 year = ~1.5-2.5MB
- **Negligible.** Postgres TEXT columns stored out-of-line, don't affect row read perf.

### Implementation

In `CcTxnImportService.toPersistable()`, pass the `PolledMessage` subject + body through:

```typescript
private toPersistable(
  parsed: ParsedBankTransaction,
  dedupeKey: string,
  message: PolledMessage,
): PersistableTransaction {
  return {
    // ... existing fields ...
    emailSubject: message.subject,
    emailBody: message.body,
  }
}
```

One-line change in the import pipeline. Body is already fetched — just not saved.

### Backfill strategy for existing transactions

Existing transactions have `emailId` (Gmail message ID) but no stored body. To backfill:

1. Query transactions where `emailBody IS NULL` and `emailId IS NOT NULL`
2. Batch-fetch from Gmail using `GmailPollService.fetchByMessageId()`
3. Store the body on each transaction

Run as a one-time migration job. After that, all new imports store body automatically.

---

## Resilience & Format Change Handling

### Risk: Bank changes email format

Two failure modes:

1. **Parser breaks** — regex can't extract merchant at all (merchant = fallback "HDFC card")
2. **Merchant naming changes** — parser works but output no longer matches categorization rules

### Defense layers

```
Layer 1: Parser resilience
  - Multiple regex patterns per bank (fallback chain)
  - Additive approach: new patterns added, old ones kept for historical emails
  - Detection: parseMiss count spikes in ImportRunSummary

Layer 2: Rule redundancy
  - Multiple patterns per service (e.g., "SWIGGY" + "BUNDL TECHNOLOGIES" + "BUNDL TECH")
  - If naming changes, one of the alternate patterns catches it

Layer 3: LLM fallback (format-agnostic)
  - Reads emailBody semantically — doesn't rely on regex patterns
  - Auto-heals: LLM result promoted to a rule for future matching
  - Works even when parser output is degraded

Layer 4: Monitoring + alerting
  - Post-import check: if uncategorized rate > 30%, fire alert
  - Separate alert if parseMiss rate spikes (parser break)
  - Dashboard metric: categorization coverage % over time
```

### Recovery playbook

| Scenario | Detection | Recovery |
|---|---|---|
| Bank changes email template | `parseMiss` spikes, import alert fires | Add new regex to parser → re-process stored `emailBody` for missed period |
| Merchant naming convention changes | Uncategorized rate spikes | LLM auto-heals OR manually add new rule pattern |
| Gmail token expires | Import fails with `REAUTH_REQUIRED` | User re-auths; historical data safe in `emailBody` — no data loss |
| Email deleted from Gmail | Can't re-fetch for retry | Stored `emailBody` still available — can re-parse from DB |

### Key principle

**Store raw source (email body), derive everything else.** If any derived field (merchant,
category, amount) is wrong, you can always re-derive from the stored body without external
dependencies.

---

## Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Cost efficiency** | LLM only for unknowns (~5-10%), cached as rules after first hit |
| **Instant for most txns** | Rule engine runs synchronously on import, no async wait |
| **Personalization** | Tenant rules override system defaults |
| **Self-improving** | Every LLM result + user correction becomes a permanent rule |
| **Graceful degradation** | No LLM configured? App still works with 80% coverage via rules |
| **Audit trail** | `categorySource` + stored `emailBody` = full traceability |
| **No vendor lock-in** | LLM is pluggable (OpenAI/Claude/local), rules are portable |
| **Source of truth** | Raw email body stored — can re-derive any field at any time |
| **Gmail independence** | After import, no dependency on Gmail for re-processing |

---

## Implementation Order

1. Schema migration (Category, MerchantCategoryRule, Transaction fields incl. `emailSubject`/`emailBody`)
2. Update import pipeline to persist email body (one-line change in `toPersistable`)
3. Backfill existing transactions with email body (one-time migration via Gmail fetch)
4. Category CRUD endpoints
5. Rule engine (Tier 1) — synchronous, on transaction create/import
6. Seed data (system categories + ~200 merchant rules)
7. Category breakdown endpoint
8. Frontend: category chip on ExpenseRow + CategoryHeatGridCard wiring
9. Manual category correction (PATCH endpoint + optional rule creation)
10. Heuristics (Tier 2)
11. LLM batch job (Tier 3) — reads `emailBody` from DB
12. Monitoring: uncategorized rate alerting post-import
13. Backfill categorization for all existing transactions
