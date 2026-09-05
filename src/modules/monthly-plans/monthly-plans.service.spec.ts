import { MonthlyPlansService } from '@/modules/monthly-plans/monthly-plans.service'
import { IMonthlyPlanRepository } from '@/modules/monthly-plans/domain/repositories/monthly-plan.repository'
import { FdLedgerService } from '@/modules/fd-ledger/fd-ledger.service'
import { InvestmentsService } from '@/modules/investments/investments.service'

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

describe('MonthlyPlansService', () => {
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
    syncContribution: jest.fn(),
    normalizePacket: jest.fn((value: unknown) => {
      if (!value || typeof value !== 'object') return { amount: 0, quantity: 0 }
      const row = value as { amount?: number; quantity?: number }
      return { amount: Number(row.amount ?? 0), quantity: Number(row.quantity ?? 0) }
    }),
  }
  const investments = {
    summarize: jest.fn(),
    lockAndValidatePlanWrite: jest.fn(),
  }
  const service = new MonthlyPlansService(
    repository as unknown as IMonthlyPlanRepository,
    prisma as never,
    fdLedger as unknown as FdLedgerService,
    investments as unknown as InvestmentsService,
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
    investments.summarize.mockResolvedValue({
      mfBalance: 0,
      stocksBalance: 0,
      soldMfRupees: 0,
      soldStocksRupees: 0,
      investmentBalance: 0,
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

  it('moves investment sale proceeds to cash while conserving total corpus', async () => {
    repository.listByTenant.mockResolvedValue([
      basePlan({ sipMf: 20_000, stocks: 30_000 }),
    ] as never)
    prisma.pftSetting.findFirst.mockResolvedValue({
      prevLiquidBalance: 5_000,
      prevInvestmentBalance: 10_000,
      stashDeductions: 0,
    })
    investments.summarize.mockResolvedValue({
      mfBalance: 15_000,
      stocksBalance: 32_000,
      soldMfRupees: 5_000,
      soldStocksRupees: 8_000,
      investmentBalance: 47_000,
    })

    const summary = await service.getDashboardSummary('tenant-1')

    expect(summary.corpus.cashLike).toBe(18_000)
    expect(summary.corpus.mf).toBe(15_000)
    expect(summary.corpus.stocks).toBe(32_000)
    expect(summary.corpus.investment).toBe(47_000)
    expect(summary.corpus.total).toBe(65_000)
  })

  it('keeps gross investment allocations in deficit math and FD values in FD summary', async () => {
    repository.listByTenant.mockResolvedValue([
      basePlan({ salary: 10_000, sipMf: 20_000, stocks: 30_000 }),
    ] as never)
    prisma.pftSetting.findFirst.mockResolvedValue({
      prevLiquidBalance: 5_000,
      prevInvestmentBalance: 10_000,
      stashDeductions: 0,
    })
    investments.summarize.mockResolvedValue({
      mfBalance: 15_000,
      stocksBalance: 32_000,
      soldMfRupees: 5_000,
      soldStocksRupees: 8_000,
      investmentBalance: 47_000,
    })
    fdLedger.summarize.mockResolvedValue({
      remainingPackets: 2,
      fdBalance: 7_000,
      brokenFdRupees: 3_000,
      lots: [{ amount: 3_500, remainingPackets: 2 }],
    })

    const summary = await service.getDashboardSummary('tenant-1')

    expect(summary.corpus.deficitWithdrawals).toBe(40_000)
    expect(summary.corpus.fd).toBe(7_000)
    expect(summary.fd.brokenRupees).toBe(3_000)
  })

  it('locks and validates investments before writing a plan, then preserves FD sync', async () => {
    const transaction = {}
    const upsertMonthlyPlan = jest.fn().mockResolvedValue(
      basePlan({ sipMf: 7_000, stocks: 4_000, fd: { amount: 2_000, quantity: 1 } }),
    )
    repository.runInTransaction.mockImplementation(async (callback) =>
      callback({ transaction, upsertMonthlyPlan } as never),
    )
    investments.lockAndValidatePlanWrite.mockResolvedValue(undefined)
    fdLedger.syncContribution.mockResolvedValue(undefined)

    await service.upsert('tenant-1', 'user-1', {
      year: 2026,
      month: 1,
      sipMf: 7_000,
      stocks: 4_000,
      fd: { amount: 2_000, quantity: 1 },
    } as never)

    expect(investments.lockAndValidatePlanWrite).toHaveBeenCalledWith(
      'tenant-1',
      2026,
      1,
      7_000,
      4_000,
      transaction,
    )
    expect(
      investments.lockAndValidatePlanWrite.mock.invocationCallOrder[0],
    ).toBeLessThan(upsertMonthlyPlan.mock.invocationCallOrder[0])
    expect(fdLedger.syncContribution).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      2026,
      1,
      { amount: 2_000, quantity: 1 },
      transaction,
    )
  })
})
