import { CardCycleSummaryService } from './card-cycle-summary.service'

// Pin TZ regardless of CI/host default so cycleStart/cycleEnd (built from
// LOCAL Date constructors, per Asia/Kolkata prod runtime) are deterministic.
process.env.TZ = 'Asia/Kolkata'

describe('CardCycleSummaryService', () => {
  const prisma = {
    card: { findMany: jest.fn() },
    statement: { findMany: jest.fn() },
    transaction: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
  }
  const service = new CardCycleSummaryService(prisma as never)

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 4, 12))
    jest.clearAllMocks()
    prisma.card.findMany.mockResolvedValue([
      {
        id: 'card-1',
        cardKey: 'hdfc-regalia',
        issuer: 'HDFC',
        last4: '1234',
        network: 'VISA',
        statementCycleDay: 1,
        creditLimit: 100000,
        status: 'ACTIVE',
        fullCardNumberEnc: null,
        cvvEnc: null,
        expiryDate: null,
        variant: null,
      },
    ])
    prisma.statement.findMany.mockResolvedValue([
      {
        id: 'statement-1',
        cardId: 'card-1',
        dueDate: new Date(2026, 7, 20),
        minimumAmountDue: 100,
        totalAmountDue: 1000,
        status: 'DUE',
        statementSyncMonth: '2026-08',
        statementMonth: '2026-08',
      },
    ])
    prisma.transaction.aggregate.mockResolvedValue({
      _sum: { amount: 2200 },
      _count: { _all: 2 },
    })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('uses SPLIT personal share and one AMORTIZE slice for effective cycle spend', async () => {
        const transactions = [
      {
        cardId: 'card-1',
        amount: 1000,
        txnDate: new Date(2026, 7, 2),
        adjustment: { type: 'SPLIT', personalShare: 250, amortizeMonths: null },
      },
      {
        cardId: 'card-1',
        amount: 1200,
        txnDate: new Date(2026, 7, 3),
        adjustment: { type: 'AMORTIZE', personalShare: null, amortizeMonths: 12 },
      },
    ]
    prisma.transaction.findMany.mockResolvedValue(transactions)

    const summary = await service.getSummary('tenant-1')

    expect(summary.cards[0]).toMatchObject({
      cycleSpend: 2200,
      effectiveCycleSpend: 350,
      adjustedAmount: 1850,
    })
        expect(summary.totalEffectiveCycleSpend).toBe(350)
    expect(summary.calendarMonthEffectiveSpend).toBe(350)
    expect(summary.cards[0].calendarMonthSpend).toBe(2200)
    expect(summary.cards[0].calendarMonthEffectiveSpend).toBe(350)
  })

  it('reports cycleStart/cycleEnd as local calendar dates, not UTC-shifted', async () => {
    // Regression test: formatDate() used to do date.toISOString().slice(0,10),
    // which converts to UTC first. An IST-local midnight (e.g. Aug 1 00:00 IST)
    // is Jul 31 18:30 UTC, so the old code reported cycleStart one day early -
    // desyncing the Transactions "Cycle" filter (which trusts these strings)
    // from the correct spend total (which uses the raw Date instants directly).
    prisma.transaction.findMany.mockResolvedValue([])

    const summary = await service.getSummary('tenant-1')

    // fakeNow = Aug 4, 2026; cycleDay = 1 -> current cycle is Aug 1 through today.
    expect(summary.cards[0].cycleStart).toBe('2026-08-01')
    expect(summary.cards[0].cycleEnd).toBe('2026-08-04')
  })

  it('reports unsettledAmount as this cycle current spend-so-far when sync is pending', async () => {
    // Regression test: unsettledAmount used to be max(0, previousFullCycleTotal
    // - thisCycleSpendSoFar) - subtracting two disjoint, unrelated months'
    // totals, producing a number with no real financial meaning. It should
    // just be "this cycle's spend so far", labeled unsettled because there is
    // no confirming statement for it yet - not a separate reconciliation figure.
    prisma.statement.findMany.mockResolvedValue([
      {
        id: 'statement-1',
        cardId: 'card-1',
        dueDate: new Date(2026, 6, 20),
        minimumAmountDue: 100,
        totalAmountDue: 1000,
        status: 'DUE',
        statementSyncMonth: '2026-07', // stale: older than the expected 2026-08
        statementMonth: '2026-07',
      },
    ])
    prisma.transaction.findMany.mockResolvedValue([])

    const summary = await service.getSummary('tenant-1')

    expect(summary.cards[0].statementSyncPending).toBe(true)
    expect(summary.cards[0].unsettledAmount).toBe(summary.cards[0].cycleSpend)
    expect(summary.cards[0].unsettledAmount).toBe(2200)
  })

  it('lastMonthStatementTotal sums statements matching exactly the previous calendar month', async () => {
    // fakeNow = Aug 4, 2026 -> previous month is July ("2026-07"). A card's own
    // "latest" statement may already be for August (this running month) once
    // its cycle day has passed - that must NOT be double-counted here; only
    // statements whose statementMonth is precisely "2026-07" should count.
    prisma.statement.findMany.mockImplementation(({ where }: { where: { statementMonth?: string } }) => {
            if (where.statementMonth === '2026-07') {
        return Promise.resolve([
          { cardId: 'card-1', totalAmountDue: 4500 },
          { cardId: 'card-1', totalAmountDue: 1200 },
        ])
      }
      return Promise.resolve([
        {
          id: 'statement-1',
          cardId: 'card-1',
          dueDate: new Date(2026, 7, 20),
          minimumAmountDue: 100,
          totalAmountDue: 1000,
          status: 'DUE',
          statementSyncMonth: '2026-08',
          statementMonth: '2026-08',
        },
      ])
    })
    prisma.transaction.findMany.mockResolvedValue([])

        const summary = await service.getSummary('tenant-1')

    expect(summary.lastMonthStatementTotal).toBe(5700)
    expect(summary.cards[0].lastMonthStatementTotal).toBe(5700)
  })
})
