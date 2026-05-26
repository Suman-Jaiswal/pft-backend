import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { PftSettingEntity } from '@/modules/settings/domain/entities/pft-setting.entity'
import {
  IPftSettingRepository,
  PFT_SETTING_REPOSITORY,
} from '@/modules/settings/domain/repositories/pft-setting.repository'
import { UpdatePftSettingsDto } from '@/modules/settings/presentation/dto/update-pft-settings.dto'

export type PftBaselineRow = {
  id: string
  periodKey: string
  version: number
  source: string
  lockedAt: string
  lockedBy: string
  metrics: Record<string, unknown>
  createdAt: string
}

@Injectable()
export class SettingsService {
  constructor(
    @Inject(PFT_SETTING_REPOSITORY) private readonly repository: IPftSettingRepository,
    private readonly prisma: PrismaService,
  ) {}

  async getPftSettings(tenantId: string): Promise<PftSettingEntity> {
    const existing = await this.repository.findByTenantId(tenantId)
    if (existing) return existing
    const now = new Date()
    const defaults = new PftSettingEntity(
      `pst_${randomUUID()}`,
      tenantId,
      now,
      now,
      'system',
      'system',
      'INR',
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      null,
      1,
    )
    return this.repository.upsert(defaults)
  }

  async updatePftSettings(
    tenantId: string,
    actorId: string,
    dto: UpdatePftSettingsDto,
  ): Promise<PftSettingEntity> {
    const current = await this.getPftSettings(tenantId)
    const updated = new PftSettingEntity(
      current.id,
      current.tenantId,
      current.createdAt,
      new Date(),
      current.createdBy,
      actorId,
      dto.currency ?? current.currency,
      dto.defaultSalary ?? current.defaultSalary,
      dto.defaultOtherIncome ?? current.defaultOtherIncome,
      dto.defaultRent ?? current.defaultRent,
      dto.defaultCook ?? current.defaultCook,
      dto.defaultLoanRepayment ?? current.defaultLoanRepayment,
      dto.defaultSip ?? current.defaultSip,
      dto.defaultInvestment ?? current.defaultInvestment,
      dto.defaultLiquidSaved ?? current.defaultLiquidSaved,
      dto.defaultBills ?? current.defaultBills,
      dto.defaultBasicExpenses ?? current.defaultBasicExpenses,
      dto.defaultOtherExpenses ?? current.defaultOtherExpenses,
      dto.prevLiquidBalance ?? current.prevLiquidBalance,
      dto.prevInvestmentBalance ?? current.prevInvestmentBalance,
      dto.stashBalance ?? current.stashBalance,
      dto.dashboardYearRange ?? current.dashboardYearRange,
      dto.dashboardBaselineVersion ?? current.dashboardBaselineVersion,
    )
    return this.repository.upsert(updated)
  }

  async deductStash(tenantId: string, actorId: string, amount: number): Promise<PftSettingEntity> {
    const current = await this.getPftSettings(tenantId)
    const nextStash = Math.max(0, current.stashBalance - Math.max(0, amount))
    const updated = new PftSettingEntity(
      current.id,
      current.tenantId,
      current.createdAt,
      new Date(),
      current.createdBy,
      actorId,
      current.currency,
      current.defaultSalary,
      current.defaultOtherIncome,
      current.defaultRent,
      current.defaultCook,
      current.defaultLoanRepayment,
      current.defaultSip,
      current.defaultInvestment,
      current.defaultLiquidSaved,
      current.defaultBills,
      current.defaultBasicExpenses,
      current.defaultOtherExpenses,
      current.prevLiquidBalance,
      current.prevInvestmentBalance,
      nextStash,
      current.dashboardYearRange,
      current.dashboardBaselineVersion,
    )
    return this.repository.upsert(updated)
  }

  async listBaselines(tenantId: string, periodKey: string): Promise<PftBaselineRow[]> {
    const rows = await this.prisma.pftBaseline.findMany({
      where: { tenantId, periodKey },
      orderBy: { version: 'asc' },
    })
    return rows.map((row) => ({
      id: row.id,
      periodKey: row.periodKey,
      version: row.version,
      source: row.source,
      lockedAt: row.lockedAt.toISOString(),
      lockedBy: row.lockedBy,
      metrics: this.asMetricsRecord(row.metrics),
      createdAt: row.createdAt.toISOString(),
    }))
  }

  async createBaseline(
    tenantId: string,
    actorId: string,
    payload: { periodKey: string; source: string; lockedBy: string; metrics: Record<string, unknown> },
  ): Promise<PftBaselineRow> {
    const aggregate = await this.prisma.pftBaseline.aggregate({
      where: { tenantId, periodKey: payload.periodKey },
      _max: { version: true },
    })
    const nextVersion = (aggregate._max.version ?? 0) + 1
    const now = new Date()
    const row = await this.prisma.pftBaseline.create({
      data: {
        id: `pbl_${randomUUID()}`,
        tenantId,
        periodKey: payload.periodKey,
        version: nextVersion,
        source: payload.source,
        lockedAt: now,
        lockedBy: payload.lockedBy || actorId,
        metrics: payload.metrics as Prisma.InputJsonValue,
        createdBy: actorId,
        updatedBy: actorId,
      },
    })
    return {
      id: row.id,
      periodKey: row.periodKey,
      version: row.version,
      source: row.source,
      lockedAt: row.lockedAt.toISOString(),
      lockedBy: row.lockedBy,
      metrics: this.asMetricsRecord(row.metrics),
      createdAt: row.createdAt.toISOString(),
    }
  }

  async getBaselineForVersion(
    tenantId: string,
    periodKey: string,
    version?: number,
  ): Promise<PftBaselineRow | null> {
    const rows = await this.prisma.pftBaseline.findMany({
      where: { tenantId, periodKey },
      orderBy: { version: 'asc' },
    })
    if (rows.length === 0) return null
    const requested = typeof version === 'number' ? rows.find((row) => row.version === version) : null
    const selected = requested ?? rows.find((row) => row.version === 1) ?? rows[0]
    if (!selected) return null
    return {
      id: selected.id,
      periodKey: selected.periodKey,
      version: selected.version,
      source: selected.source,
      lockedAt: selected.lockedAt.toISOString(),
      lockedBy: selected.lockedBy,
      metrics: this.asMetricsRecord(selected.metrics),
      createdAt: selected.createdAt.toISOString(),
    }
  }

  private asMetricsRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    return {}
  }
}
