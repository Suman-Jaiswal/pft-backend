import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { PftSettingEntity } from '@/modules/settings/domain/entities/pft-setting.entity'
import {
  IPftSettingRepository,
  PFT_SETTING_REPOSITORY,
} from '@/modules/settings/domain/repositories/pft-setting.repository'
import { UpdatePftSettingsDto } from '@/modules/settings/presentation/dto/update-pft-settings.dto'
import { FdLedgerService, type FdLot } from '@/modules/fd-ledger/fd-ledger.service'
import { coerceFdPacket } from '@/modules/fd-ledger/fd-packet'

export type PftBaselineRow = {
  id: string
  periodKey: string
  version: number
  source: string
  baselineAmount: number | null
  lockedAt: string
  lockedBy: string
  metrics: Record<string, unknown>
  createdAt: string
}

export type PftSettingsWithComputedStash = PftSettingEntity & {
  computedStashBalance: number
  computedFdBalance: number
  remainingFdPackets: number
  brokenFdRupees: number
  fdLots: FdLot[]
}

export type DeductStashResult = {
  setting: PftSettingEntity
  appliedDeduction: number
}

const MAX_PLAN_DEFAULT_SLATES = 6
const MAX_PLAN_DEFAULT_SLATE_LABEL_LENGTH = 12

function toFiniteNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

@Injectable()
export class SettingsService {
  constructor(
    @Inject(PFT_SETTING_REPOSITORY) private readonly repository: IPftSettingRepository,
    private readonly prisma: PrismaService,
    private readonly fdLedger: FdLedgerService,
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
      0, 0, 0, 0, 0, 0, 0,
      { amount: 0, quantity: 0 },
      [],
      0, 0, 0, 0, 0, 0, 0, 0,
      null,
      1,
      null,
      null,
      null,
      null,
      null,
    )
    return this.repository.upsert(defaults)
  }

  async getPftSettingsWithComputedStash(tenantId: string): Promise<PftSettingsWithComputedStash> {
    const settings = await this.getPftSettings(tenantId)
    const [aggregate, fdSummary] = await Promise.all([
      this.prisma.monthlyPlan.aggregate({
        where: { tenantId },
        _sum: { stash: true },
      }),
      this.fdLedger.summarize(tenantId),
    ])
    const totalStash = Number(aggregate._sum.stash ?? 0)
    return {
      ...settings,
      computedStashBalance: totalStash - Number(settings.stashDeductions ?? 0),
      computedFdBalance: fdSummary.fdBalance,
      remainingFdPackets: fdSummary.remainingPackets,
      brokenFdRupees: fdSummary.brokenFdRupees,
      fdLots: fdSummary.lots,
    }
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
      dto.defaultOtherSources ?? current.defaultOtherSources,
      dto.defaultRent ?? current.defaultRent,
      dto.defaultCook ?? current.defaultCook,
      dto.defaultLoanRepayment ?? current.defaultLoanRepayment,
      dto.defaultSipMf ?? current.defaultSipMf,
      dto.defaultStocks ?? current.defaultStocks,
      dto.defaultFd === undefined ? current.defaultFd : this.fdLedger.normalizePacket(dto.defaultFd),
      dto.defaultGoalPayments === undefined
        ? current.defaultGoalPayments
        : this.normalizeGoalPayments(dto.defaultGoalPayments),
      dto.defaultSavings ?? current.defaultSavings,
      dto.defaultStash ?? current.defaultStash,
      dto.defaultBills ?? current.defaultBills,
      dto.defaultBasicExpenses ?? current.defaultBasicExpenses,
      dto.defaultOtherExpenses ?? current.defaultOtherExpenses,
      dto.prevLiquidBalance ?? current.prevLiquidBalance,
      dto.prevInvestmentBalance ?? current.prevInvestmentBalance,
      dto.stashDeductions ?? current.stashDeductions,
      dto.dashboardYearRange ?? current.dashboardYearRange,
      dto.dashboardBaselineVersion ?? current.dashboardBaselineVersion,
      this.normalizePlanDefaultSlates(
        dto.planDefaultSlates !== undefined ? dto.planDefaultSlates : current.planDefaultSlates,
        {
          salary: dto.defaultSalary ?? current.defaultSalary,
          otherSources: dto.defaultOtherSources ?? current.defaultOtherSources,
          rent: dto.defaultRent ?? current.defaultRent,
          cook: dto.defaultCook ?? current.defaultCook,
          loanRepayment: dto.defaultLoanRepayment ?? current.defaultLoanRepayment,
          sipMf: dto.defaultSipMf ?? current.defaultSipMf,
          stocks: dto.defaultStocks ?? current.defaultStocks,
          fd:
            dto.defaultFd === undefined
              ? current.defaultFd
              : this.fdLedger.normalizePacket(dto.defaultFd),
          goalPayments:
            dto.defaultGoalPayments === undefined
              ? current.defaultGoalPayments
              : this.normalizeGoalPayments(dto.defaultGoalPayments),
          savings: dto.defaultSavings ?? current.defaultSavings,
          stash: dto.defaultStash ?? current.defaultStash,
          bills: dto.defaultBills ?? current.defaultBills,
          otherExpenses: dto.defaultOtherExpenses ?? current.defaultOtherExpenses,
        },
      ),
      current.importGmailRefreshToken,
      current.importGmailEmail,
      current.importGmailScope,
      current.importGmailTokenUpdatedAt,
    )
    return this.repository.upsert(updated)
  }

  async deductStash(tenantId: string, actorId: string, amount: number): Promise<DeductStashResult> {
    const current = await this.getPftSettings(tenantId)
    const aggregate = await this.prisma.monthlyPlan.aggregate({
      where: { tenantId },
      _sum: { stash: true },
    })
    const totalStash = Number(aggregate._sum.stash ?? 0)
    const currentDeductions = Math.max(0, current.stashDeductions)
    const availableStash = Math.max(0, totalStash - currentDeductions)
    const requestedDeduction = Math.max(0, amount)
    if (requestedDeduction > availableStash) {
      throw new BadRequestException(
        `Deduction exceeds current stash balance (available: ₹${availableStash.toLocaleString('en-IN')}).`,
      )
    }
    const appliedDeduction = requestedDeduction
    const nextDeductions = currentDeductions + appliedDeduction
    const updated = new PftSettingEntity(
      current.id,
      current.tenantId,
      current.createdAt,
      new Date(),
      current.createdBy,
      actorId,
      current.currency,
      current.defaultSalary,
      current.defaultOtherSources,
      current.defaultRent,
      current.defaultCook,
      current.defaultLoanRepayment,
      current.defaultSipMf,
      current.defaultStocks,
      current.defaultFd,
      current.defaultGoalPayments,
      current.defaultSavings,
      current.defaultStash,
      current.defaultBills,
      current.defaultBasicExpenses,
      current.defaultOtherExpenses,
      current.prevLiquidBalance,
      current.prevInvestmentBalance,
      nextDeductions,
      current.dashboardYearRange,
      current.dashboardBaselineVersion,
      this.normalizePlanDefaultSlates(current.planDefaultSlates, {
        salary: current.defaultSalary,
        otherSources: current.defaultOtherSources,
        rent: current.defaultRent,
        cook: current.defaultCook,
        loanRepayment: current.defaultLoanRepayment,
        sipMf: current.defaultSipMf,
        stocks: current.defaultStocks,
        fd: current.defaultFd,
        goalPayments: current.defaultGoalPayments,
        savings: current.defaultSavings,
        stash: current.defaultStash,
        bills: current.defaultBills,
        otherExpenses: current.defaultOtherExpenses,
      }),
      current.importGmailRefreshToken,
      current.importGmailEmail,
      current.importGmailScope,
      current.importGmailTokenUpdatedAt,
    )
    const setting = await this.repository.upsert(updated)
    return { setting, appliedDeduction }
  }

  breakFd(tenantId: string, actorId: string, quantity: number, amount?: number) {
    return this.fdLedger.breakPackets(tenantId, actorId, quantity, amount)
  }

  listFdTransactions(tenantId: string) {
    return this.fdLedger.listTransactions(tenantId)
  }

  undoFdBreak(tenantId: string, entryId: string) {
    return this.fdLedger.undoBreak(tenantId, entryId)
  }

  async listBaselines(tenantId: string, periodKey?: string): Promise<PftBaselineRow[]> {
    const rows = await this.prisma.pftBaseline.findMany({
      where: periodKey ? { tenantId, periodKey } : { tenantId },
      orderBy: [{ periodKey: 'asc' }, { version: 'asc' }],
    })
    return rows.map((row) => ({
      id: row.id,
      periodKey: row.periodKey,
      version: row.version,
      source: row.source,
      baselineAmount: row.baselineAmount == null ? null : Number(row.baselineAmount),
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
    const baselineAmount = this.parseBaselineAmount(payload.metrics.baselineAmount)
    const existing = await this.prisma.pftBaseline.findFirst({
      where: { tenantId, periodKey: payload.periodKey },
      select: { id: true },
    })
    if (existing) {
      throw new BadRequestException(`Baseline already exists for period ${payload.periodKey}`)
    }
    const now = new Date()
    const row = await this.prisma.pftBaseline.create({
      data: {
        id: `pbl_${randomUUID()}`,
        tenantId,
        periodKey: payload.periodKey,
        version: 1,
        source: payload.source,
        baselineAmount,
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
      baselineAmount: row.baselineAmount == null ? null : Number(row.baselineAmount),
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
      baselineAmount: selected.baselineAmount == null ? null : Number(selected.baselineAmount),
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

  private parseBaselineAmount(value: unknown): number | null {
    if (value == null || value === '') return null
    const numeric = toFiniteNumber(value)
    return numeric > 0 ? numeric : 0
  }

  private normalizeGoalPayments(
    value: unknown,
  ): Array<{ id: string; name: string; amount: number }> {
    if (!Array.isArray(value)) throw new BadRequestException('defaultGoalPayments must be an array.')
    return value.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new BadRequestException('Invalid goal payment.')
      }
      const row = item as Record<string, unknown>
      const id = typeof row.id === 'string' ? row.id.trim() : ''
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      const amount = Number(row.amount)
      if (!id || !name || !Number.isFinite(amount) || amount < 0) {
        throw new BadRequestException('Invalid goal payment.')
      }
      return { id, name, amount }
    })
  }

  private normalizePlanDefaultSlates(
    raw: unknown,
    defaults: {
      salary: number
      otherSources: number
      rent: number
      cook: number
      loanRepayment: number
      sipMf: number
      stocks: number
      fd: { amount: number; quantity: number }
      goalPayments: Array<{ id: string; name: string; amount: number }>
      savings: number
      stash: number
      bills: number
      otherExpenses: number
    },
  ): Array<{ id: string; name: string; serial: number; defaults: Record<string, unknown> }> {
    const fallback = {
      id: 'ins-0',
      name: 'ins-0',
      serial: 0,
      defaults: { ...defaults },
    }
    if (!Array.isArray(raw) || raw.length === 0) return [fallback]
    const out: Array<{ id: string; name: string; serial: number; defaults: Record<string, unknown> }> = []
    for (const item of raw.slice(0, MAX_PLAN_DEFAULT_SLATES)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const row = item as Record<string, unknown>
      const serial = Math.max(0, Math.floor(toFiniteNumber(row.serial)))
      const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `ins-${serial}`
      const rawName = typeof row.name === 'string' ? row.name.trim() : ''
      const name = (rawName || id).slice(0, MAX_PLAN_DEFAULT_SLATE_LABEL_LENGTH)
      const sourceDefaults =
        row.defaults && typeof row.defaults === 'object' && !Array.isArray(row.defaults)
          ? (row.defaults as Record<string, unknown>)
          : {}
      out.push({
        id,
        name,
        serial,
        defaults: {
          salary: toFiniteNumber(sourceDefaults.salary ?? defaults.salary),
          otherSources: toFiniteNumber(sourceDefaults.otherSources ?? defaults.otherSources),
          rent: toFiniteNumber(sourceDefaults.rent ?? defaults.rent),
          cook: toFiniteNumber(sourceDefaults.cook ?? defaults.cook),
          loanRepayment: toFiniteNumber(sourceDefaults.loanRepayment ?? defaults.loanRepayment),
          sipMf: toFiniteNumber(sourceDefaults.sipMf ?? defaults.sipMf),
          stocks: toFiniteNumber(sourceDefaults.stocks ?? defaults.stocks),
          fd:
            sourceDefaults.fd === undefined
              ? defaults.fd
              : coerceFdPacket(sourceDefaults.fd),
          goalPayments:
            sourceDefaults.goalPayments === undefined
              ? defaults.goalPayments
              : this.normalizeGoalPayments(sourceDefaults.goalPayments),
          savings: toFiniteNumber(sourceDefaults.savings ?? defaults.savings),
          stash: toFiniteNumber(sourceDefaults.stash ?? defaults.stash),
          bills: toFiniteNumber(sourceDefaults.bills ?? defaults.bills),
          otherExpenses: toFiniteNumber(sourceDefaults.otherExpenses ?? defaults.otherExpenses),
        },
      })
    }
    if (out.length === 0) return [fallback]
    const hasIns0 = out.some((row) => row.id === 'ins-0')
    if (!hasIns0) out.unshift(fallback)
    return out.slice(0, MAX_PLAN_DEFAULT_SLATES)
  }
}
