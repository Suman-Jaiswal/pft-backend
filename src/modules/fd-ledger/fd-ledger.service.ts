import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'

export type FdPacket = { amount: number; quantity: number }
/** Remaining packets for one denomination, so callers can break a specific packet size. */
export type FdLot = { amount: number; remainingPackets: number }
export type FdTransaction = {
  id: string
  kind: string
  amount: number
  quantity: number
  totalAmount: number
  year: number | null
  month: number | null
  sourceEntryId: string | null
  source: 'MONTHLY_PLAN' | 'FD_LEDGER'
  createdAt: string
}
export type FdSummary = {
  remainingPackets: number
  fdBalance: number
  brokenFdRupees: number
  lots: FdLot[]
}

@Injectable()
export class FdLedgerService {
  private readonly logger = new Logger(FdLedgerService.name)

  constructor(private readonly prisma: PrismaService) {}

  normalizePacket(value: unknown): FdPacket {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('FD must be an { amount, quantity } object.')
    }
    const row = value as Record<string, unknown>
    const amount = Number(row.amount)
    const quantity = Number(row.quantity)
    if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(quantity) || quantity < 0) {
      throw new BadRequestException('FD amount must be non-negative and quantity an integer.')
    }
    if ((amount === 0) !== (quantity === 0)) {
      throw new BadRequestException('FD amount and quantity must both be zero or both be positive.')
    }
    return { amount, quantity }
  }

  summarize(tenantId: string): Promise<FdSummary> {
    return this.prisma.fdLedgerEntry
      .findMany({ where: { tenantId } })
      .then((entries) => this.summarizeEntries(entries))
  }

  async listTransactions(tenantId: string): Promise<FdTransaction[]> {
    const entries = await this.prisma.fdLedgerEntry.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    return entries.map((entry) => {
      const amount = Number(entry.amount)
      return {
        id: entry.id,
        kind: entry.kind,
        amount,
        quantity: entry.quantity,
        totalAmount: amount * entry.quantity,
        year: entry.year,
        month: entry.month,
        sourceEntryId: entry.sourceEntryId,
        source: entry.kind === 'CONTRIBUTION' ? 'MONTHLY_PLAN' : 'FD_LEDGER',
        createdAt: entry.createdAt.toISOString(),
      }
    })
  }

  async syncContribution(
    tenantId: string,
    actorId: string,
    year: number,
    month: number,
    packet: FdPacket,
    transaction?: Prisma.TransactionClient,
  ) {
    const run = async (tx: Prisma.TransactionClient) => {
      await this.lockTenant(tx, tenantId)
      const existing = await tx.fdLedgerEntry.findUnique({
        where: { tenantId_year_month: { tenantId, year, month } },
      })
      if (existing) {
        const consumed = await tx.fdLedgerEntry.aggregate({
          where: { tenantId, kind: 'BREAK', sourceEntryId: existing.id },
          _sum: { quantity: true },
        })
        const consumedQuantity = Number(consumed._sum.quantity ?? 0)
        if (packet.quantity < consumedQuantity) {
          throw new BadRequestException(
            `FD contribution cannot be below ${consumedQuantity} already-broken packets.`,
          )
        }
        if (consumedQuantity > 0 && Number(existing.amount) !== packet.amount) {
          throw new BadRequestException(
            'FD denomination cannot change after packets from this contribution were broken.',
          )
        }
      }
      return tx.fdLedgerEntry.upsert({
        where: { tenantId_year_month: { tenantId, year, month } },
        update: {
          amount: packet.amount,
          quantity: packet.quantity,
        },
        create: {
          id: `fdl_${randomUUID()}`,
          tenantId,
          kind: 'CONTRIBUTION',
          amount: packet.amount,
          quantity: packet.quantity,
          year,
          month,
          createdBy: actorId,
        },
      })
    }
    return transaction ? run(transaction) : this.prisma.$transaction(run)
  }

  async breakPackets(
    tenantId: string,
    actorId: string,
    quantity: number,
    denomination?: number,
  ): Promise<Omit<FdSummary, 'brokenFdRupees' | 'lots'> & { rupees: number }> {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException('Break quantity must be a positive integer.')
    }
    if (denomination != null && (!Number.isFinite(denomination) || denomination <= 0)) {
      throw new BadRequestException('FD packet amount must be a positive number.')
    }
    return this.prisma.$transaction(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const entries = await tx.fdLedgerEntry.findMany({
        where: { tenantId },
        orderBy: [{ year: 'asc' }, { month: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      })
      const contributions = entries.filter(
        (entry) =>
          entry.kind === 'CONTRIBUTION' &&
          (denomination == null || Number(entry.amount) === denomination),
      )
      const consumedBySource = new Map<string, number>()
      for (const entry of entries) {
        if (entry.kind === 'BREAK' && entry.sourceEntryId) {
          consumedBySource.set(
            entry.sourceEntryId,
            (consumedBySource.get(entry.sourceEntryId) ?? 0) + entry.quantity,
          )
        }
      }
      const available = contributions.reduce(
        (sum, lot) => sum + Math.max(0, lot.quantity - (consumedBySource.get(lot.id) ?? 0)),
        0,
      )
      if (quantity > available) {
        this.logger.warn(
          `Rejected FD break tenant=${tenantId} requested=${quantity} available=${available} denomination=${denomination ?? 'any'}`,
        )
        throw new BadRequestException(
          denomination == null
            ? `Break exceeds remaining FD packets (available: ${available}).`
            : `Break exceeds remaining ₹${denomination} packets (available: ${available}).`,
        )
      }

      let needed = quantity
      let rupees = 0
      for (const lot of contributions) {
        if (needed === 0) break
        const remaining = Math.max(0, lot.quantity - (consumedBySource.get(lot.id) ?? 0))
        const take = Math.min(remaining, needed)
        if (take === 0) continue
        await tx.fdLedgerEntry.create({
          data: {
            id: `fdl_${randomUUID()}`,
            tenantId,
            kind: 'BREAK',
            amount: lot.amount,
            quantity: take,
            sourceEntryId: lot.id,
            createdBy: actorId,
          },
        })
        rupees += Number(lot.amount) * take
        needed -= take
      }
      const before = this.summarizeEntries(entries)
      const result = {
        rupees,
        remainingPackets: before.remainingPackets - quantity,
        fdBalance: before.fdBalance - rupees,
      }
      this.logger.log(
        `FD break tenant=${tenantId} quantity=${quantity} denomination=${denomination ?? 'any'} rupees=${rupees}`,
      )
      return result
    })
  }

  async undoBreak(
    tenantId: string,
    entryId: string,
  ): Promise<{ revertedRupees: number; restoredPackets: number }> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const entry = await tx.fdLedgerEntry.findFirst({
        where: { id: entryId, tenantId, kind: 'BREAK' },
      })
      if (!entry) {
        throw new BadRequestException('Only an existing FD break transaction can be undone.')
      }
      await tx.fdLedgerEntry.delete({ where: { id: entry.id } })
      const restoredPackets = entry.quantity
      const revertedRupees = Number(entry.amount) * restoredPackets
      this.logger.log(
        `FD break undone tenant=${tenantId} entry=${entryId} quantity=${restoredPackets} rupees=${revertedRupees}`,
      )
      return { revertedRupees, restoredPackets }
    })
  }

  private summarizeEntries(
    entries: Array<{ kind: string; amount: unknown; quantity: number }>,
  ): FdSummary {
    let contributedPackets = 0
    let contributedRupees = 0
    let brokenPackets = 0
    let brokenFdRupees = 0
    const remainingByAmount = new Map<number, number>()
    for (const entry of entries) {
      const amount = Number(entry.amount)
      const rupees = amount * entry.quantity
      const signedQuantity = entry.kind === 'CONTRIBUTION' ? entry.quantity : -entry.quantity
      if (entry.kind === 'CONTRIBUTION') {
        contributedPackets += entry.quantity
        contributedRupees += rupees
      } else if (entry.kind === 'BREAK') {
        brokenPackets += entry.quantity
        brokenFdRupees += rupees
      } else {
        continue
      }
      remainingByAmount.set(amount, (remainingByAmount.get(amount) ?? 0) + signedQuantity)
    }
    const lots = [...remainingByAmount.entries()]
      .filter(([, remainingPackets]) => remainingPackets > 0)
      .map(([amount, remainingPackets]) => ({ amount, remainingPackets }))
      .sort((a, b) => a.amount - b.amount)
    return {
      remainingPackets: contributedPackets - brokenPackets,
      fdBalance: contributedRupees - brokenFdRupees,
      brokenFdRupees,
      lots,
    }
  }

  private async lockTenant(tx: Prisma.TransactionClient, tenantId: string) {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', tenantId)
  }
}
