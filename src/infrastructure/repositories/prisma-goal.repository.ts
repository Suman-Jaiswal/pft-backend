import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import {
  GoalUpsertInput,
  IGoalRepository,
} from '@/modules/goals/domain/repositories/goal.repository'

@Injectable()
export class PrismaGoalRepository implements IGoalRepository {
  constructor(private readonly prisma: PrismaService) {}

  listByTenant(tenantId: string) {
    return this.prisma.goal.findMany({
      where: { tenantId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    })
  }

  upsert(input: GoalUpsertInput) {
    return this.prisma.goal.upsert({
      where: { id: input.id },
      update: {
        name: input.name,
        targetAmount: input.targetAmount,
        deadline: input.deadline,
        priority: input.priority,
        status: input.status,
        updatedBy: input.actorId,
      },
      create: {
        id: input.id,
        tenantId: input.tenantId,
        name: input.name,
        targetAmount: input.targetAmount,
        deadline: input.deadline,
        priority: input.priority,
        status: input.status,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      },
    })
  }

  async transitionStatus(
    tenantId: string,
    actorId: string,
    id: string,
    status: 'ACTIVE' | 'COMPLETED',
  ) {
    const result = await this.prisma.goal.updateMany({
      where: { tenantId, id },
      data: { status, updatedBy: actorId },
    })
    return result.count
  }
}
