import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { decryptField } from '@/shared/crypto/field-cipher'

type CardCycleSummaryRow = {
  cardId: string
  cardKey: string
  issuer: string
  last4: string | null
  network: string | null
  statementCycleDay: number | null
  creditLimit: number | null
  cardStatus: string
  fullCardNumber: string | null
  cvv: string | null
  expiryDate: string | null
  variant: string | null
  latestStatementId: string | null
  latestStatementMonth: string | null
  cycleSpend: number
  cycleStart: string
  cycleEnd: string
  txnCount: number
  statementTotal: number
  minDue: number
  status: string | null
  dueDate: string | null
  statementSyncMonth: string | null
  statementSyncPending: boolean
  missingLatestStatement: boolean
  canManualUpdate: boolean
  unsettledAmount: number
  trend: {
    pct: number | null
    direction: 'up' | 'down' | 'flat' | 'none'
  }
}

export type CardCycleSummaryResponse = {
  totalCycleSpend: number
  totalStatementDues: number
  totalUnsettled: number
  cards: CardCycleSummaryRow[]
}

type BillingWindow = {
  start: Date
  endExclusive: Date
}

@Injectable()
export class CardCycleSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(tenantId: string): Promise<CardCycleSummaryResponse> {
    const now = new Date()
    const cards = await this.prisma.card.findMany({
      where: { tenantId, status: { not: 'DELETED' } },
      select: {
        id: true,
        cardKey: true,
        issuer: true,
        last4: true,
        network: true,
        statementCycleDay: true,
        creditLimit: true,
        status: true,
        fullCardNumberEnc: true,
        cvvEnc: true,
        expiryDate: true,
        variant: true,
      },
      orderBy: { cardKey: 'asc' },
    })

    if (!cards.length) {
      return {
        totalCycleSpend: 0,
        totalStatementDues: 0,
        totalUnsettled: 0,
        cards: [],
      }
    }

    const latestStatements = await this.prisma.statement.findMany({
      where: { tenantId, cardId: { in: cards.map((card) => card.id) } },
      select: {
        id: true,
        cardId: true,
        dueDate: true,
        minimumAmountDue: true,
        totalAmountDue: true,
        status: true,
        statementSyncMonth: true,
        statementMonth: true,
      },
      orderBy: [{ cardId: 'asc' }, { statementMonth: 'desc' }, { createdAt: 'desc' }],
    })

    const latestByCardId = new Map<string, (typeof latestStatements)[number]>()
    for (const statement of latestStatements) {
      if (!latestByCardId.has(statement.cardId)) latestByCardId.set(statement.cardId, statement)
    }

    const currentMonth = this.formatMonth(now)
    const rows: CardCycleSummaryRow[] = []

    for (const card of cards) {
      const cycleDay = this.resolveCycleDay(card.statementCycleDay)
      const latest = latestByCardId.get(card.id) ?? null
      const statementSyncMonth = latest?.statementSyncMonth ?? null
      const statementSyncPending = this.isStatementSyncPending(cycleDay, statementSyncMonth, now)
      const cycleWindow = this.getCycleWindow(now, cycleDay)
      const settled = await this.aggregateCardSpend(card.id, tenantId, cycleWindow)
      const widenedWindow = statementSyncPending ? this.getPreviousMonthWindow(now, cycleDay) : cycleWindow
      const widened = statementSyncPending
        ? await this.aggregateCardSpend(card.id, tenantId, widenedWindow)
        : settled
      const unsettledAmount = statementSyncPending
        ? Math.max(0, widened.sumAmount - settled.sumAmount)
        : 0
      const statementTotal = latest ? Number(latest.totalAmountDue) : 0
      const minDue = latest ? Number(latest.minimumAmountDue) : 0
      const trendPct =
        statementTotal > 0 ? Number((((settled.sumAmount - statementTotal) / statementTotal) * 100).toFixed(1)) : null

      rows.push({
        cardId: card.id,
        cardKey: card.cardKey,
        issuer: card.issuer,
        last4: card.last4,
        network: card.network,
        statementCycleDay: card.statementCycleDay,
        creditLimit: card.creditLimit == null ? null : Number(card.creditLimit),
        cardStatus: card.status,
        fullCardNumber: this.decryptOrNull(card.fullCardNumberEnc),
        cvv: this.decryptOrNull(card.cvvEnc),
        expiryDate: card.expiryDate,
        variant: card.variant,
        latestStatementId: latest?.id ?? null,
        latestStatementMonth: latest?.statementMonth ?? null,
        cycleSpend: settled.sumAmount,
        cycleStart: this.formatDate(cycleWindow.start),
        cycleEnd: this.formatDate(new Date(cycleWindow.endExclusive.getTime() - 86_400_000)),
        txnCount: settled.txnCount,
        statementTotal,
        minDue,
        status: latest?.status ?? null,
        dueDate: latest ? this.formatDate(latest.dueDate) : null,
        statementSyncMonth,
        statementSyncPending,
        missingLatestStatement: !latest,
        canManualUpdate: !latest || statementSyncPending,
        unsettledAmount,
        trend: {
          pct: trendPct,
          direction: this.getTrendDirection(trendPct),
        },
      })
    }

    const totalCycleSpend = rows.reduce((sum, row) => sum + row.cycleSpend, 0)
    const totalStatementDues = rows.reduce((sum, row) => sum + row.statementTotal, 0)
    const totalUnsettled = rows.reduce((sum, row) => sum + row.unsettledAmount, 0)

    return {
      totalCycleSpend,
      totalStatementDues,
      totalUnsettled,
      cards: rows,
    }
  }

  private async aggregateCardSpend(cardId: string, tenantId: string, window: BillingWindow): Promise<{
    sumAmount: number
    txnCount: number
  }> {
    const agg = await this.prisma.transaction.aggregate({
      where: {
        tenantId,
        cardId,
        txnDate: {
          gte: window.start,
          lt: window.endExclusive,
        },
      },
      _sum: { amount: true },
      _count: { _all: true },
    })
    return {
      sumAmount: Number(agg._sum.amount ?? 0),
      txnCount: Number(agg._count._all ?? 0),
    }
  }

  private resolveCycleDay(value: number | null): number {
    if (!value || value < 1 || value > 31) return 17
    return Math.floor(value)
  }

  private getCycleWindow(now: Date, cycleDay: number): BillingWindow {
    const endExclusive = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const todayDom = now.getDate()
    if (todayDom >= cycleDay) {
      const start = new Date(now.getFullYear(), now.getMonth(), cycleDay)
      return { start, endExclusive }
    }
    const start = new Date(now.getFullYear(), now.getMonth() - 1, cycleDay)
    return { start, endExclusive }
  }

  private getPreviousMonthWindow(now: Date, cycleDay: number): BillingWindow {
    const cycleStart = this.getCycleWindow(now, cycleDay).start
    const start = new Date(cycleStart.getFullYear(), cycleStart.getMonth() - 1, cycleDay)
    return { start, endExclusive: new Date(cycleStart.getTime()) }
  }

  private isStatementSyncPending(cycleDay: number, syncMonth: string | null, now: Date): boolean {
    if (!syncMonth) return true
    if (now.getDate() < cycleDay) return false
    return syncMonth.localeCompare(this.formatMonth(now)) < 0
  }

  private formatMonth(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10)
  }

  private getTrendDirection(pct: number | null): 'up' | 'down' | 'flat' | 'none' {
    if (pct == null) return 'none'
    if (pct > 0) return 'up'
    if (pct < 0) return 'down'
    return 'flat'
  }

  private decryptOrNull(value: string | null): string | null {
    if (!value) return null
    try {
      return decryptField(value)
    } catch {
      return null
    }
  }
}
