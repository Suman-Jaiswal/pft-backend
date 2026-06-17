import { Injectable } from '@nestjs/common'
import { Card } from '@prisma/client'
import {
  CardEntity,
  CardStatus,
} from '@/modules/cards/domain/entities/card.entity'
import {
  CardQuery,
  ICardRepository,
} from '@/modules/cards/domain/repositories/card.repository'
import { CardKey } from '@/modules/cards/domain/value-objects/card-key.vo'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { decryptField, encryptField } from '@/shared/crypto/field-cipher'

function decryptOrNull(value: string | null): string | null {
  if (!value) return null
  try {
    return decryptField(value)
  } catch {
    return null
  }
}

function toEntity(row: Card): CardEntity {
  return new CardEntity(
    row.id,
    row.tenantId,
    row.createdAt,
    row.updatedAt,
    row.createdBy,
    row.updatedBy,
    CardKey.create(row.cardKey),
    row.issuer,
    row.last4,
    row.network,
    row.statementCycleDay,
    row.creditLimit ? Number(row.creditLimit) : null,
    row.status as CardStatus,
    decryptOrNull(row.fullCardNumberEnc),
    decryptOrNull(row.cvvEnc),
    row.expiryDate,
    row.variant,
  )
}

@Injectable()
export class PrismaCardRepository implements ICardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(card: CardEntity): Promise<CardEntity> {
    const row = await this.prisma.card.create({
      data: {
        id: card.id,
        tenantId: card.tenantId,
        cardKey: card.cardKey.value,
        issuer: card.issuer,
        last4: card.last4,
        network: card.network,
        statementCycleDay: card.statementCycleDay,
        creditLimit: card.creditLimit ?? undefined,
        fullCardNumberEnc: card.fullCardNumber ? encryptField(card.fullCardNumber) : undefined,
        cvvEnc: card.cvv ? encryptField(card.cvv) : undefined,
        expiryDate: card.expiryDate ?? undefined,
        variant: card.variant ?? undefined,
        status: card.status,
        createdBy: card.createdBy,
        updatedBy: card.updatedBy,
      },
    })
    return toEntity(row)
  }

  async findById(tenantId: string, id: string): Promise<CardEntity | null> {
    const row = await this.prisma.card.findFirst({ where: { tenantId, id } })
    return row ? toEntity(row) : null
  }

  async findByCardKey(tenantId: string, cardKey: string): Promise<CardEntity | null> {
    const row = await this.prisma.card.findFirst({ where: { tenantId, cardKey } })
    return row ? toEntity(row) : null
  }

  async list(query: CardQuery): Promise<{ items: CardEntity[]; total: number }> {
    const skip = (query.page - 1) * query.pageSize
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.card.findMany({
        where: { tenantId: query.tenantId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
      }),
      this.prisma.card.count({ where: { tenantId: query.tenantId } }),
    ])
    return { items: rows.map(toEntity), total }
  }

  async update(card: CardEntity): Promise<CardEntity> {
    const row = await this.prisma.card.update({
      where: { id: card.id },
      data: {
        issuer: card.issuer,
        last4: card.last4,
        network: card.network,
        statementCycleDay: card.statementCycleDay,
        creditLimit: card.creditLimit ?? undefined,
        fullCardNumberEnc: card.fullCardNumber ? encryptField(card.fullCardNumber) : undefined,
        cvvEnc: card.cvv ? encryptField(card.cvv) : undefined,
        expiryDate: card.expiryDate ?? undefined,
        variant: card.variant ?? undefined,
        status: card.status,
        updatedBy: card.updatedBy,
      },
    })
    return toEntity(row)
  }
}
