import { CardCycleSummaryService } from './card-cycle-summary.service'

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
        amount: 1000,
        txnDate: new Date(2026, 7, 2),
        adjustment: { type: 'SPLIT', personalShare: 250, amortizeMonths: null },
      },
      {
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
  })
})
