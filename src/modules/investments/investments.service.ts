import { BadRequestException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'

export type InvestmentAssetType = 'MF' | 'STOCKS'

export type InvestmentSummary = {
  mfBalance: number
  stocksBalance: number
  soldMfRupees: number
  soldStocksRupees: number
  investmentBalance: number
}

type InvestmentClient = Pick<
  Prisma.TransactionClient,
  'monthlyPlan' | 'pftSetting' | 'investmentSale'
>

@Injectable()
export class InvestmentsService {
  constructor(private readonly prisma: PrismaService) {}

  summarize(tenantId: string): Promise<InvestmentSummary> {
    return this.summarizeWithClient(this.prisma, tenantId)
  }

  async listTransactions(tenantId: string, asset: string) {
    const assetType = this.normalizeAsset(asset)
    const [plans, sales] = await Promise.all([
      this.prisma.monthlyPlan.findMany({
        where: { tenantId },
        select: {
          id: true,
          sipMf: true,
          stocks: true,
          year: true,
          month: true,
          createdAt: true,
        },
      }),
      this.prisma.investmentSale.findMany({
        where: { tenantId, assetType },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ])
    const purchases = plans
      .map((plan) => {
        const amount = Number(assetType === 'MF' ? plan.sipMf : plan.stocks)
        return {
          id: `monthly-plan:${plan.id}:${assetType}`,
          assetType,
          kind: 'PURCHASE' as const,
          amount,
          source: 'MONTHLY_PLAN' as const,
          year: plan.year,
          month: plan.month,
          createdAt: plan.createdAt.toISOString(),
        }
      })
      .filter((row) => row.amount > 0)
    const saleRows = sales
      .filter((sale) => sale.assetType === assetType)
      .map((sale) => ({
        id: sale.id,
        assetType,
        kind: 'SELL' as const,
        amount: Number(sale.amount),
        source: 'INVESTMENT_LEDGER' as const,
        year: null,
        month: null,
        createdAt: sale.createdAt.toISOString(),
      }))
    return [...purchases, ...saleRows].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    )
  }

  async sell(tenantId: string, actorId: string, asset: string, amount: number) {
    const assetType = this.normalizeAsset(asset)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Sale amount must be a positive finite number.')
    }
    return this.prisma.$transaction(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const summary = await this.summarizeWithClient(tx, tenantId)
      const available = assetType === 'MF' ? summary.mfBalance : summary.stocksBalance
      if (amount > available) {
        throw new BadRequestException(
          `Sale exceeds available ${assetType} balance (available: ${available}).`,
        )
      }
      const sale = await tx.investmentSale.create({
        data: {
          id: `invs_${randomUUID()}`,
          tenantId,
          assetType,
          amount,
          createdBy: actorId,
        },
      })
      return {
        id: sale.id,
        assetType,
        amount: Number(sale.amount),
        createdAt: sale.createdAt.toISOString(),
      }
    })
  }

  async undoSale(
    tenantId: string,
    saleId: string,
  ): Promise<{ revertedRupees: number; assetType: InvestmentAssetType }> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const sale = await tx.investmentSale.findFirst({
        where: { id: saleId, tenantId },
      })
      if (!sale) {
        throw new BadRequestException('Investment sale was not found for this tenant.')
      }
      await tx.investmentSale.delete({ where: { id: sale.id } })
      return {
        revertedRupees: Number(sale.amount),
        assetType: this.normalizeAsset(sale.assetType),
      }
    })
  }

  async lockAndValidatePlanWrite(
    tenantId: string,
    year: number,
    month: number,
    sipMf: number | undefined,
    stocks: number | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await this.lockTenant(tx, tenantId)
    const [plans, setting, sales] = await Promise.all([
      tx.monthlyPlan.findMany({
        where: { tenantId },
        select: { year: true, month: true, sipMf: true, stocks: true },
      }),
      tx.pftSetting.findFirst({
        where: { tenantId },
        select: { prevInvestmentBalance: true },
      }),
      tx.investmentSale.findMany({
        where: { tenantId },
        select: { assetType: true, amount: true },
      }),
    ])
    const current = plans.find((plan) => plan.year === year && plan.month === month)
    const otherPlans = plans.filter((plan) => plan.year !== year || plan.month !== month)
    const nextSipMf = sipMf ?? Number(current?.sipMf ?? 0)
    const nextStocks = stocks ?? Number(current?.stocks ?? 0)
    const purchasedMf =
      nextSipMf + otherPlans.reduce((sum, plan) => sum + Number(plan.sipMf), 0)
    const purchasedStocks =
      nextStocks + otherPlans.reduce((sum, plan) => sum + Number(plan.stocks), 0)
    const soldMf = sales.reduce(
      (sum, sale) => sum + (sale.assetType === 'MF' ? Number(sale.amount) : 0),
      0,
    )
    const soldStocks = sales.reduce(
      (sum, sale) => sum + (sale.assetType === 'STOCKS' ? Number(sale.amount) : 0),
      0,
    )
    if (purchasedMf < soldMf) {
      throw new BadRequestException('Plan edit would reduce MF purchases below already-sold rupees.')
    }
    const availableStocks = Number(setting?.prevInvestmentBalance ?? 0) + purchasedStocks
    if (availableStocks < soldStocks) {
      throw new BadRequestException(
        'Plan edit would reduce stocks purchases and opening balance below already-sold rupees.',
      )
    }
  }

  async lockAndValidateOpeningBalance(
    tenantId: string,
    nextPrevInvestmentBalance: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await this.lockTenant(tx, tenantId)
    const [plans, sales] = await Promise.all([
      tx.monthlyPlan.findMany({
        where: { tenantId },
        select: { stocks: true },
      }),
      tx.investmentSale.findMany({
        where: { tenantId, assetType: 'STOCKS' },
        select: { amount: true },
      }),
    ])
    const purchasedStocks = plans.reduce((sum, plan) => sum + Number(plan.stocks), 0)
    const soldStocks = sales.reduce((sum, sale) => sum + Number(sale.amount), 0)
    if (nextPrevInvestmentBalance + purchasedStocks < soldStocks) {
      throw new BadRequestException(
        'Opening investment balance and stocks purchases cannot be reduced below already-sold rupees.',
      )
    }
  }

  private normalizeAsset(asset: string): InvestmentAssetType {
    const normalized = asset.trim().toUpperCase()
    if (normalized !== 'MF' && normalized !== 'STOCKS') {
      throw new BadRequestException('Asset must be mf or stocks.')
    }
    return normalized
  }

  private async summarizeWithClient(
    client: InvestmentClient,
    tenantId: string,
  ): Promise<InvestmentSummary> {
    const [plans, setting, sales] = await Promise.all([
      client.monthlyPlan.findMany({
        where: { tenantId },
        select: { sipMf: true, stocks: true },
      }),
      client.pftSetting.findFirst({
        where: { tenantId },
        select: { prevInvestmentBalance: true },
      }),
      client.investmentSale.findMany({
        where: { tenantId },
        select: { assetType: true, amount: true },
      }),
    ])
    const purchasedMf = plans.reduce((sum, plan) => sum + Number(plan.sipMf), 0)
    const purchasedStocks = plans.reduce((sum, plan) => sum + Number(plan.stocks), 0)
    const soldMfRupees = sales.reduce(
      (sum, sale) => sum + (sale.assetType === 'MF' ? Number(sale.amount) : 0),
      0,
    )
    const soldStocksRupees = sales.reduce(
      (sum, sale) => sum + (sale.assetType === 'STOCKS' ? Number(sale.amount) : 0),
      0,
    )
    const mfBalance = purchasedMf - soldMfRupees
    const stocksBalance =
      Number(setting?.prevInvestmentBalance ?? 0) + purchasedStocks - soldStocksRupees
    return {
      mfBalance,
      stocksBalance,
      soldMfRupees,
      soldStocksRupees,
      investmentBalance: mfBalance + stocksBalance,
    }
  }

  private async lockTenant(tx: Prisma.TransactionClient, tenantId: string) {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `investments:${tenantId}`,
    )
  }
}
