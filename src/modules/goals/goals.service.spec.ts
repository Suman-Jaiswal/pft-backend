import { BadRequestException } from '@nestjs/common'
import { GoalsService } from '@/modules/goals/goals.service'
import { IGoalRepository } from '@/modules/goals/domain/repositories/goal.repository'

describe('GoalsService', () => {
  const repository: jest.Mocked<IGoalRepository> = {
    listByTenant: jest.fn(),
    upsert: jest.fn(),
    transitionStatus: jest.fn(),
  }
  const service = new GoalsService(repository)

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
})
