import { BadRequestException } from '@nestjs/common'
import { InvestmentsService } from '@/modules/investments/investments.service'

describe('InvestmentsService', () => {
  const plans = [
    {
      id: 'plan-1',
      sipMf: 5_000,
      stocks: 3_000,
      year: 2026,
      month: 1,
      createdAt: new Date('2026-01-05T00:00:00.000Z'),
    },
    {
      id: 'plan-2',
      sipMf: 2_000,
      stocks: 0,
      year: 2026,
      month: 2,
      createdAt: new Date('2026-02-05T00:00:00.000Z'),
    },
  ]
  const sales = [
    {
      id: 'sale-mf',
      tenantId: 'tenant-1',
      assetType: 'MF',
      amount: 1_000,
      createdAt: new Date('2026-03-05T00:00:00.000Z'),
      createdBy: 'user-1',
    },
    {
      id: 'sale-stocks',
      tenantId: 'tenant-1',
      assetType: 'STOCKS',
      amount: 4_000,
      createdAt: new Date('2026-04-05T00:00:00.000Z'),
      createdBy: 'user-1',
    },
  ]
  const tx = {
    $executeRawUnsafe: jest.fn(),
    monthlyPlan: { findMany: jest.fn() },
    pftSetting: { findFirst: jest.fn() },
    investmentSale: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
  }
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    monthlyPlan: { findMany: jest.fn() },
    pftSetting: { findFirst: jest.fn() },
    investmentSale: { findMany: jest.fn() },
  }
  const service = new InvestmentsService(prisma as never)

  beforeEach(() => {
    jest.clearAllMocks()
    prisma.monthlyPlan.findMany.mockResolvedValue(plans)
    prisma.pftSetting.findFirst.mockResolvedValue({ prevMfBalance: 0, prevStocksBalance: 10_000 })
    prisma.investmentSale.findMany.mockResolvedValue(sales)
    tx.monthlyPlan.findMany.mockResolvedValue(plans)
    tx.pftSetting.findFirst.mockResolvedValue({ prevMfBalance: 0, prevStocksBalance: 10_000 })
    tx.investmentSale.findMany.mockResolvedValue(sales)
  })

  it('summarizes purchases, previous investment, and sales', async () => {
    await expect(service.summarize('tenant-1')).resolves.toEqual({
      mfBalance: 6_000,
      stocksBalance: 9_000,
      soldMfRupees: 1_000,
      soldStocksRupees: 4_000,
      investmentBalance: 15_000,
    })
  })

  it('includes opening MF in the current MF balance', async () => {
    prisma.pftSetting.findFirst.mockResolvedValue({ prevMfBalance: 2_000, prevStocksBalance: 10_000 })

    await expect(service.summarize('tenant-1')).resolves.toEqual({
      mfBalance: 8_000,
      stocksBalance: 9_000,
      soldMfRupees: 1_000,
      soldStocksRupees: 4_000,
      investmentBalance: 17_000,
    })
  })

  it('merges monthly purchases and sales newest first without tenant data', async () => {
    await expect(service.listTransactions('tenant-1', 'mf')).resolves.toEqual([
      {
        id: 'sale-mf',
        assetType: 'MF',
        kind: 'SELL',
        amount: 1_000,
        source: 'INVESTMENT_LEDGER',
        year: null,
        month: null,
        createdAt: '2026-03-05T00:00:00.000Z',
      },
      {
        id: 'monthly-plan:plan-2:MF',
        assetType: 'MF',
        kind: 'PURCHASE',
        amount: 2_000,
        source: 'MONTHLY_PLAN',
        year: 2026,
        month: 2,
        createdAt: '2026-02-05T00:00:00.000Z',
      },
      {
        id: 'monthly-plan:plan-1:MF',
        assetType: 'MF',
        kind: 'PURCHASE',
        amount: 5_000,
        source: 'MONTHLY_PLAN',
        year: 2026,
        month: 1,
        createdAt: '2026-01-05T00:00:00.000Z',
      },
    ])
    expect(prisma.monthlyPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-1' } }),
    )
    expect(prisma.investmentSale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-1', assetType: 'MF' } }),
    )
  })

  it('lists STOCKS purchases and ledger sales from their correct sources', async () => {
    await expect(service.listTransactions('tenant-1', 'stocks')).resolves.toEqual([
      {
        id: 'sale-stocks',
        assetType: 'STOCKS',
        kind: 'SELL',
        amount: 4_000,
        source: 'INVESTMENT_LEDGER',
        year: null,
        month: null,
        createdAt: '2026-04-05T00:00:00.000Z',
      },
      {
        id: 'monthly-plan:plan-1:STOCKS',
        assetType: 'STOCKS',
        kind: 'PURCHASE',
        amount: 3_000,
        source: 'MONTHLY_PLAN',
        year: 2026,
        month: 1,
        createdAt: '2026-01-05T00:00:00.000Z',
      },
    ])
    expect(prisma.investmentSale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-1', assetType: 'STOCKS' } }),
    )
  })

  it.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN])(
    'rejects non-positive or non-finite sale amount %s',
    async (amount) => {
      await expect(service.sell('tenant-1', 'user-1', 'mf', amount)).rejects.toBeInstanceOf(
        BadRequestException,
      )
      expect(prisma.$transaction).not.toHaveBeenCalled()
    },
  )

  it('rejects a sale above the available asset balance', async () => {
    await expect(service.sell('tenant-1', 'user-1', 'mf', 6_001)).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(tx.investmentSale.create).not.toHaveBeenCalled()
  })

  it('locks the tenant and creates a sale inside one transaction', async () => {
    tx.investmentSale.create.mockResolvedValue({
      id: 'sale-new',
      assetType: 'MF',
      amount: 500,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
    })

    await expect(service.sell('tenant-1', 'user-1', 'MF', 500)).resolves.toEqual({
      id: 'sale-new',
      assetType: 'MF',
      amount: 500,
      createdAt: '2026-05-01T00:00:00.000Z',
    })
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'investments:tenant-1',
    )
    expect(tx.investmentSale.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        assetType: 'MF',
        amount: 500,
        createdBy: 'user-1',
      }),
    })
  })

  it('undoes only a sale owned by the tenant', async () => {
    tx.investmentSale.findFirst.mockResolvedValue({
      id: 'sale-mf',
      tenantId: 'tenant-1',
      assetType: 'MF',
      amount: 1_000,
    })

    await expect(service.undoSale('tenant-1', 'sale-mf')).resolves.toEqual({
      revertedRupees: 1_000,
      assetType: 'MF',
    })
    expect(tx.investmentSale.findFirst).toHaveBeenCalledWith({
      where: { id: 'sale-mf', tenantId: 'tenant-1' },
    })
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'investments:tenant-1',
    )
    expect(tx.investmentSale.delete).toHaveBeenCalledWith({ where: { id: 'sale-mf' } })

    tx.investmentSale.findFirst.mockResolvedValue(null)
    await expect(service.undoSale('tenant-2', 'sale-mf')).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('rejects a plan edit that would reduce stocks below already-sold rupees under the lock', async () => {
    tx.investmentSale.findMany.mockResolvedValue([
      {
        id: 'sale-stocks',
        assetType: 'STOCKS',
        amount: 12_000,
      },
    ])

    await expect(
      service.lockAndValidatePlanWrite('tenant-1', 2026, 1, undefined, 1_000, tx as never),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'investments:tenant-1',
    )
    expect(tx.$executeRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(
      tx.monthlyPlan.findMany.mock.invocationCallOrder[0],
    )
  })

  it('rejects an opening balance that would reduce stocks below already-sold rupees under the lock', async () => {
    tx.monthlyPlan.findMany.mockResolvedValue([
      { year: 2026, month: 1, sipMf: 0, stocks: 3_000 },
    ])
    tx.investmentSale.findMany.mockResolvedValue([
      { assetType: 'STOCKS', amount: 4_001 },
    ])

    await expect(
      service.lockAndValidateOpeningBalance(
        'tenant-1',
        { prevMfBalance: 0, prevStocksBalance: 1_000 },
        tx as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'investments:tenant-1',
    )
    expect(tx.$executeRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(
      tx.monthlyPlan.findMany.mock.invocationCallOrder[0],
    )
  })

  it('rejects an opening MF balance that would reduce MF below already-sold rupees', async () => {
    tx.monthlyPlan.findMany.mockResolvedValue([
      { year: 2026, month: 1, sipMf: 1_000, stocks: 0 },
    ])
    tx.investmentSale.findMany.mockResolvedValue([{ assetType: 'MF', amount: 2_001 }])

    await expect(
      service.lockAndValidateOpeningBalance(
        'tenant-1',
        { prevMfBalance: 1_000, prevStocksBalance: 0 },
        tx as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects a plan edit that would reduce MF purchases below already-sold rupees', async () => {
    tx.investmentSale.findMany.mockResolvedValue([
      { assetType: 'MF', amount: 3_001 },
    ])

    await expect(
      service.lockAndValidatePlanWrite('tenant-1', 2026, 1, 1_000, undefined, tx as never),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
