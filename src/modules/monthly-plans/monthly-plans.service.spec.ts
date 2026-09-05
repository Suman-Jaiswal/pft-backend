import { MonthlyPlansService } from '@/modules/monthly-plans/monthly-plans.service'
import { IMonthlyPlanRepository } from '@/modules/monthly-plans/domain/repositories/monthly-plan.repository'
import { FdLedgerService } from '@/modules/fd-ledger/fd-ledger.service'

function basePlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    tenantId: 'tenant-1',
    month: 1,
    year: 2026,
    rent: 0,
    cook: 0,
    bills: 0,
    sipMf: 0,
    savings: 0,
    stash: 0,
    stocks: 0,
    fd: { amount: 0, quantity: 0 },
    otherExpenses: 0,
    salary: 100_000,
    otherSources: 0,
    loanPayments: [],
    goalPayments: [],
    customExpenses: [],
    banks: {},
    remarks: '',
    ...overrides,
  }
}

describe('MonthlyPlansService.getDashboardSummary goal cashLike accounting', () => {
  const repository: jest.Mocked<Pick<IMonthlyPlanRepository, 'listByTenant' | 'findCurrent' | 'runInTransaction'>> =
    {
      listByTenant: jest.fn(),
      findCurrent: jest.fn(),
      runInTransaction: jest.fn(),
    }
  const prisma = {
    pftSetting: { findFirst: jest.fn() },
    loan: { findMany: jest.fn() },
  }
  const fdLedger = {
    summarize: jest.fn(),
    normalizePacket: jest.fn((value: unknown) => {
      if (!value || typeof value !== 'object') return { amount: 0, quantity: 0 }
      const row = value as { amount?: number; quantity?: number }
      return { amount: Number(row.amount ?? 0), quantity: Number(row.quantity ?? 0) }
    }),
  }
  const service = new MonthlyPlansService(
    repository as unknown as IMonthlyPlanRepository,
    prisma as never,
    fdLedger as unknown as FdLedgerService,
  )

  beforeEach(() => {
    jest.clearAllMocks()
    prisma.pftSetting.findFirst.mockResolvedValue({
      prevLiquidBalance: 0,
      prevInvestmentBalance: 0,
      stashDeductions: 0,
    })
    prisma.loan.findMany.mockResolvedValue([])
    fdLedger.summarize.mockResolvedValue({
      remainingPackets: 0,
      fdBalance: 0,
      brokenFdRupees: 0,
      lots: [],
    })
  })

  it('treats positive goalPayments as cashLike savings and keeps them in deficit math', async () => {
    repository.listByTenant.mockResolvedValue([
      basePlan({
        savings: 0,
        stash: 2_000,
        salary: 100_000,
        goalPayments: [
          { id: 'goal-1', name: 'Emergency', amount: 7_000 },
          { id: 'goal-2', name: 'Travel', amount: 3_000 },
        ],
      }),
    ] as never)

    const covered = await service.getDashboardSummary('tenant-1')

    // Goals (₹10k) must land in cashLike; stash stays in its own bucket.
    expect(covered.corpus.cashLike).toBe(10_000)
    expect(covered.corpus.liquid).toBe(10_000)
    expect(covered.corpus.total).toBe(10_000)
    expect(covered.corpus.deficitWithdrawals).toBe(0)
    expect(covered.stash.balance).toBe(2_000)

    repository.listByTenant.mockResolvedValue([
      basePlan({
        savings: 0,
        stash: 0,
        salary: 5_000,
        goalPayments: [{ id: 'goal-1', name: 'Emergency', amount: 10_000 }],
      }),
    ] as never)

    const deficitCase = await service.getDashboardSummary('tenant-1')

    // liquid out = 10_000 goals → deficit vs ₹5_000 income = 5_000
    // cashLike = +10_000 goals − 5_000 deficit = 5_000 (not −5_000)
    expect(deficitCase.corpus.deficitWithdrawals).toBe(5_000)
    expect(deficitCase.corpus.cashLike).toBe(5_000)
    expect(deficitCase.corpus.liquid).toBe(5_000)
    expect(deficitCase.stash.balance).toBe(0)
  })
})
