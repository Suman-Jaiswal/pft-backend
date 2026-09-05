import type { Goal } from '@prisma/client'

export const GOAL_REPOSITORY = Symbol('GOAL_REPOSITORY')

export type GoalUpsertInput = {
  id: string
  tenantId: string
  actorId: string
  name: string
  targetAmount?: number
  deadline?: Date
  priority?: number
  status: 'ACTIVE' | 'COMPLETED'
}

export interface IGoalRepository {
  listByTenant(tenantId: string): Promise<Goal[]>
  upsert(input: GoalUpsertInput): Promise<Goal>
  transitionStatus(
    tenantId: string,
    actorId: string,
    id: string,
    status: 'ACTIVE' | 'COMPLETED',
  ): Promise<number>
}
