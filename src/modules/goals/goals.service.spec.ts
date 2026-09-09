import { BadRequestException } from '@nestjs/common'
import { GoalsService } from '@/modules/goals/goals.service'
import { IGoalRepository } from '@/modules/goals/domain/repositories/goal.repository'

describe('GoalsService', () => {
  const repository: jest.Mocked<Pick<IGoalRepository, 'listByTenant' | 'upsert' | 'transitionStatus'>> = {
    listByTenant: jest.fn(),
    upsert: jest.fn(),
    transitionStatus: jest.fn(),
  }
  const prisma = {
    monthlyPlan: { findMany: jest.fn() },
    goalLedgerEntry: {
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  }
  const service = new GoalsService(repository as unknown as IGoalRepository, prisma as never)

  beforeEach(() => jest.clearAllMocks())

  it('rejects a blank goal name', async () => {
    await expect(service.upsert('tenant-1', 'user-1', { name: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(repository.upsert).not.toHaveBeenCalled()
  })

  it('trims the name and defaults status to ACTIVE', async () => {
    repository.upsert.mockResolvedValue({ id: 'goal-1' } as never)

    await service.upsert('tenant-1', 'user-1', { name: ' Emergency fund ' })

    expect(repository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Emergency fund', status: 'ACTIVE' }),
    )
  })

  it('rejects unsupported status transitions', async () => {
    await expect(
      service.transitionStatus('tenant-1', 'user-1', 'goal-1', 'DELETED'),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('includes brokenAmount when listing goals', async () => {
    repository.listByTenant.mockResolvedValue([
      { id: 'goal-1', name: 'Travel', targetAmount: 10_000, deadline: null, priority: 1, status: 'ACTIVE', createdAt: new Date('2026-01-01') },
    ] as never)
    prisma.goalLedgerEntry.groupBy.mockResolvedValue([
      { goalId: 'goal-1', _sum: { amount: 2_500 } },
    ])

    await expect(service.list('tenant-1')).resolves.toEqual([
      expect.objectContaining({ id: 'goal-1', brokenAmount: 2_500 }),
    ])
  })

  it('lists monthly allocations and cash moves together', async () => {
    repository.listByTenant.mockResolvedValue([
      { id: 'goal-1', name: 'Travel' },
    ] as never)
    prisma.monthlyPlan.findMany.mockResolvedValue([
      {
        id: 'plan-1',
        month: 8,
        year: 2026,
        goalPayments: [{ id: 'goal-1', name: 'Travel', amount: 4_000 }],
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-02T00:00:00.000Z'),
      },
    ])
    prisma.goalLedgerEntry.findMany.mockResolvedValue([
      {
        id: 'brk-1',
        kind: 'BREAK',
        goalId: 'goal-1',
        amount: 1_500,
        createdAt: new Date('2026-08-10T00:00:00.000Z'),
      },
    ])

    await expect(service.listTransactions('tenant-1')).resolves.toEqual([
      expect.objectContaining({ id: 'brk-1', kind: 'BREAK', amount: 1_500, source: 'GOAL_LEDGER' }),
      expect.objectContaining({
        id: 'contrib:plan-1:goal-1',
        kind: 'CONTRIBUTION',
        amount: 4_000,
        source: 'MONTHLY_PLAN',
        month: 8,
        year: 2026,
      }),
    ])
  })
})
