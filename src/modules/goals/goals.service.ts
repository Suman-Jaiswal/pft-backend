import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { BreakGoalDto } from '@/modules/goals/dto/break-goal.dto'
import { UpsertGoalDto } from '@/modules/goals/dto/upsert-goal.dto'
import {
  GOAL_REPOSITORY,
  IGoalRepository,
} from '@/modules/goals/domain/repositories/goal.repository'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'

export type GoalTransaction = {
  id: string
  kind: 'CONTRIBUTION' | 'BREAK'
  goalId: string
  goalName: string
  amount: number
  year: number | null
  month: number | null
  source: 'MONTHLY_PLAN' | 'GOAL_LEDGER'
  createdAt: string
}

export type GoalListItem = {
  id: string
  name: string
  targetAmount: number | null
  deadline: Date | null
  priority: number | null
  status: string
  createdAt: Date
  brokenAmount: number
}

@Injectable()
export class GoalsService {
  constructor(
    @Inject(GOAL_REPOSITORY) private readonly repository: IGoalRepository,
    private readonly prisma: PrismaService,
  ) {}

  async list(tenantId: string): Promise<GoalListItem[]> {
    const [goals, brokenByGoal] = await Promise.all([
      this.repository.listByTenant(tenantId),
      this.brokenByGoalId(tenantId),
    ])
    return goals.map((goal) => ({
      id: goal.id,
      name: goal.name,
      targetAmount: goal.targetAmount == null ? null : Number(goal.targetAmount),
      deadline: goal.deadline,
      priority: goal.priority,
      status: goal.status,
      createdAt: goal.createdAt,
      brokenAmount: brokenByGoal.get(goal.id) ?? 0,
    }))
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

  async listTransactions(tenantId: string): Promise<GoalTransaction[]> {
    const [goals, plans, breaks] = await Promise.all([
      this.repository.listByTenant(tenantId),
      this.prisma.monthlyPlan.findMany({
        where: { tenantId },
        select: { id: true, month: true, year: true, goalPayments: true, updatedAt: true, createdAt: true },
      }),
      this.prisma.goalLedgerEntry.findMany({
        where: { tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ])
    const nameById = new Map(goals.map((goal) => [goal.id, goal.name]))
    const contributions: GoalTransaction[] = []
    for (const plan of plans) {
      if (!Array.isArray(plan.goalPayments)) continue
      for (const item of plan.goalPayments) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        const row = item as { id?: unknown; name?: unknown; amount?: unknown }
        const goalId = String(row.id ?? '').trim()
        const amount = Number(row.amount ?? 0)
        if (!goalId || !Number.isFinite(amount) || amount <= 0) continue
        contributions.push({
          id: `contrib:${plan.id}:${goalId}`,
          kind: 'CONTRIBUTION',
          goalId,
          goalName: String(row.name ?? nameById.get(goalId) ?? 'Goal').trim() || 'Goal',
          amount,
          year: plan.year,
          month: plan.month,
          source: 'MONTHLY_PLAN',
          createdAt: (plan.updatedAt ?? plan.createdAt).toISOString(),
        })
      }
    }
    const breakRows: GoalTransaction[] = breaks
      .filter((entry) => entry.kind === 'BREAK')
      .map((entry) => ({
        id: entry.id,
        kind: 'BREAK' as const,
        goalId: entry.goalId,
        goalName: nameById.get(entry.goalId) ?? 'Goal',
        amount: Number(entry.amount),
        year: null,
        month: null,
        source: 'GOAL_LEDGER' as const,
        createdAt: entry.createdAt.toISOString(),
      }))
    return [...contributions, ...breakRows].sort((left, right) => {
      const byDate = Date.parse(right.createdAt) - Date.parse(left.createdAt)
      return byDate !== 0 ? byDate : right.id.localeCompare(left.id)
    })
  }

  async undoBreak(tenantId: string, entryId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const entry = await tx.goalLedgerEntry.findFirst({
        where: { id: entryId, tenantId, kind: 'BREAK' },
      })
      if (!entry) {
        throw new BadRequestException('Only an existing goal cash move can be reverted.')
      }
      await tx.goalLedgerEntry.delete({ where: { id: entry.id } })
      const revertedRupees = Number(entry.amount)
      return { revertedRupees, goalId: entry.goalId }
    })
  }

  async summarizeBroken(tenantId: string): Promise<number> {
    const summary = await this.prisma.goalLedgerEntry.aggregate({
      where: { tenantId, kind: 'BREAK' },
      _sum: { amount: true },
    })
    return Number(summary._sum.amount ?? 0)
  }

  async breakGoal(tenantId: string, actorId: string, goalId: string, dto: BreakGoalDto) {
    const amount = Math.round(Number(dto.amount))
    if (!Number.isFinite(amount) || amount < 1) {
      throw new BadRequestException('Break amount must be at least ₹1.')
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const goal = await tx.goal.findFirst({ where: { id: goalId, tenantId } })
      if (!goal) throw new NotFoundException('Goal not found.')

      const [funded, alreadyBroken] = await Promise.all([
        this.fundedAmount(tx, tenantId, goalId),
        this.brokenAmount(tx, tenantId, goalId),
      ])
      const remaining = Math.max(0, funded - alreadyBroken)
      if (amount > remaining) {
        throw new BadRequestException(
          `Cannot move ₹${amount.toLocaleString('en-IN')} — only ₹${remaining.toLocaleString('en-IN')} remains in this goal.`,
        )
      }

      const entry = await tx.goalLedgerEntry.create({
        data: {
          tenantId,
          goalId,
          kind: 'BREAK',
          amount,
          createdBy: actorId,
        },
      })
      return {
        id: entry.id,
        amount,
        remaining: remaining - amount,
        brokenAmount: alreadyBroken + amount,
      }
    })
  }

  private async brokenByGoalId(tenantId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.goalLedgerEntry.groupBy({
      by: ['goalId'],
      where: { tenantId, kind: 'BREAK' },
      _sum: { amount: true },
    })
    return new Map(rows.map((row) => [row.goalId, Number(row._sum.amount ?? 0)]))
  }

  private async brokenAmount(
    tx: Prisma.TransactionClient,
    tenantId: string,
    goalId: string,
  ): Promise<number> {
    const summary = await tx.goalLedgerEntry.aggregate({
      where: { tenantId, goalId, kind: 'BREAK' },
      _sum: { amount: true },
    })
    return Number(summary._sum.amount ?? 0)
  }

  private async fundedAmount(
    tx: Prisma.TransactionClient,
    tenantId: string,
    goalId: string,
  ): Promise<number> {
    const plans = await tx.monthlyPlan.findMany({
      where: { tenantId },
      select: { goalPayments: true },
    })
    let funded = 0
    for (const plan of plans) {
      if (!Array.isArray(plan.goalPayments)) continue
      for (const item of plan.goalPayments) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        const row = item as { id?: unknown; amount?: unknown }
        if (String(row.id ?? '') !== goalId) continue
        const amount = Number(row.amount ?? 0)
        if (Number.isFinite(amount) && amount > 0) funded += amount
      }
    }
    return funded
  }

  private async lockTenant(tx: Prisma.TransactionClient, tenantId: string) {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', tenantId)
  }
}
