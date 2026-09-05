import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { UpsertGoalDto } from '@/modules/goals/dto/upsert-goal.dto'
import {
  GOAL_REPOSITORY,
  IGoalRepository,
} from '@/modules/goals/domain/repositories/goal.repository'

@Injectable()
export class GoalsService {
  constructor(@Inject(GOAL_REPOSITORY) private readonly repository: IGoalRepository) {}

  list(tenantId: string) {
    return this.repository.listByTenant(tenantId)
  }

  async upsert(tenantId: string, actorId: string, dto: UpsertGoalDto) {
    const name = dto.name?.trim()
    if (!name) throw new BadRequestException('Goal name is required.')
    return this.repository.upsert({
      id: dto.id ?? `gol_${randomUUID()}`,
      tenantId,
      actorId,
      name,
      targetAmount: dto.targetAmount,
      deadline: dto.deadline ? new Date(dto.deadline) : undefined,
      priority: dto.priority,
      status: dto.status ?? 'ACTIVE',
    })
  }

  async transitionStatus(
    tenantId: string,
    actorId: string,
    id: string,
    status: string,
  ) {
    if (status !== 'ACTIVE' && status !== 'COMPLETED') {
      throw new BadRequestException('Goal status must be ACTIVE or COMPLETED.')
    }
    const count = await this.repository.transitionStatus(tenantId, actorId, id, status)
    if (count === 0) throw new NotFoundException('Goal not found.')
  }
}
