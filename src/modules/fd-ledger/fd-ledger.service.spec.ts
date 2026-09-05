import { BadRequestException } from '@nestjs/common'
import { FdLedgerService } from '@/modules/fd-ledger/fd-ledger.service'

describe('FdLedgerService', () => {
  const entries = [
    {
      id: 'lot-1',
      tenantId: 'tenant-1',
      kind: 'CONTRIBUTION',
      amount: 1000,
      quantity: 2,
      sourceEntryId: null,
      year: 2026,
      month: 1,
      createdAt: new Date('2026-01-01'),
    },
    {
      id: 'lot-2',
      tenantId: 'tenant-1',
      kind: 'CONTRIBUTION',
      amount: 2500,
      quantity: 2,
      sourceEntryId: null,
      year: 2026,
      month: 2,
      createdAt: new Date('2026-02-01'),
    },
  ]

  const tx = {
    $executeRawUnsafe: jest.fn(),
    fdLedgerEntry: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
  }
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    fdLedgerEntry: {
      findMany: jest.fn(),
    },
  }
  const service = new FdLedgerService(prisma as never)

  beforeEach(() => {
    jest.clearAllMocks()
    tx.fdLedgerEntry.findMany.mockResolvedValue(entries)
    tx.fdLedgerEntry.create.mockImplementation(({ data }: { data: unknown }) =>
      Promise.resolve(data),
    )
    tx.fdLedgerEntry.delete.mockResolvedValue(undefined)
  })

  it('breaks FIFO across mixed-denomination lots and attributes each break', async () => {
    const result = await service.breakPackets('tenant-1', 'user-1', 3)

    expect(result).toEqual({
      rupees: 4500,
      remainingPackets: 1,
      fdBalance: 2500,
    })
    expect(tx.fdLedgerEntry.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'BREAK',
          amount: 1000,
          quantity: 2,
          sourceEntryId: 'lot-1',
        }),
      }),
    )
    expect(tx.fdLedgerEntry.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 2500,
          quantity: 1,
          sourceEntryId: 'lot-2',
        }),
      }),
    )
  })

  it('breaks only the requested denomination', async () => {
    const result = await service.breakPackets('tenant-1', 'user-1', 1, 2500)

    expect(result).toEqual({
      rupees: 2500,
      remainingPackets: 3,
      fdBalance: 4500,
    })
    expect(tx.fdLedgerEntry.create).toHaveBeenCalledTimes(1)
    expect(tx.fdLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 2500, quantity: 1, sourceEntryId: 'lot-2' }),
      }),
    )
  })

  it('rejects breaking more packets than the chosen denomination holds', async () => {
    await expect(service.breakPackets('tenant-1', 'user-1', 3, 2500)).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(tx.fdLedgerEntry.create).not.toHaveBeenCalled()
  })

  it('summarizes remaining packets per denomination', async () => {
    prisma.fdLedgerEntry.findMany.mockResolvedValue([
      ...entries,
      {
        id: 'break-1',
        tenantId: 'tenant-1',
        kind: 'BREAK',
        amount: 1000,
        quantity: 2,
        sourceEntryId: 'lot-1',
        year: 2026,
        month: 3,
        createdAt: new Date('2026-03-01'),
      },
    ])

    await expect(service.summarize('tenant-1')).resolves.toEqual({
      remainingPackets: 2,
      fdBalance: 5000,
      brokenFdRupees: 2000,
      lots: [{ amount: 2500, remainingPackets: 2 }],
    })
  })

  it('lists newest FD ledger transactions with normalized values', async () => {
    prisma.fdLedgerEntry.findMany.mockResolvedValue([
      entries[0],
      {
        id: 'break-1',
        tenantId: 'tenant-1',
        kind: 'BREAK',
        amount: 1000,
        quantity: 1,
        sourceEntryId: 'lot-1',
        year: null,
        month: null,
        createdAt: new Date('2026-03-01'),
      },
    ])

    await expect(service.listTransactions('tenant-1')).resolves.toEqual([
      {
        id: 'lot-1',
        kind: 'CONTRIBUTION',
        amount: 1000,
        quantity: 2,
        totalAmount: 2000,
        year: 2026,
        month: 1,
        sourceEntryId: null,
        source: 'MONTHLY_PLAN',
        createdAt: new Date('2026-01-01').toISOString(),
      },
      {
        id: 'break-1',
        kind: 'BREAK',
        amount: 1000,
        quantity: 1,
        totalAmount: 1000,
        year: null,
        month: null,
        sourceEntryId: 'lot-1',
        source: 'FD_LEDGER',
        createdAt: new Date('2026-03-01').toISOString(),
      },
    ])
    expect(prisma.fdLedgerEntry.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
  })

  it('rejects breaking more packets than remain', async () => {
    await expect(service.breakPackets('tenant-1', 'user-1', 5)).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(tx.fdLedgerEntry.create).not.toHaveBeenCalled()
  })

  it('undoes one break entry and restores its packet value', async () => {
    const brokenEntry = {
      id: 'break-1',
      tenantId: 'tenant-1',
      kind: 'BREAK',
      amount: 2500,
      quantity: 1,
      sourceEntryId: 'lot-2',
      year: null,
      month: null,
      createdAt: new Date('2026-03-01'),
    }
    tx.fdLedgerEntry.findFirst.mockResolvedValue(brokenEntry)

    await expect(service.undoBreak('tenant-1', 'break-1')).resolves.toEqual({
      revertedRupees: 2500,
      restoredPackets: 1,
    })
    expect(tx.fdLedgerEntry.findFirst).toHaveBeenCalledWith({
      where: { id: 'break-1', tenantId: 'tenant-1', kind: 'BREAK' },
    })
    expect(tx.fdLedgerEntry.delete).toHaveBeenCalledWith({ where: { id: 'break-1' } })
  })

  it('rejects undo for a contribution or another tenant entry', async () => {
    tx.fdLedgerEntry.findFirst.mockResolvedValue(null)

    await expect(service.undoBreak('tenant-1', 'lot-1')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(tx.fdLedgerEntry.delete).not.toHaveBeenCalled()
  })
})
