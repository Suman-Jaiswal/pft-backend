import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { PrismaCardRepository } from '@/infrastructure/repositories/prisma-card.repository'
import { CardEntity, CardStatus } from '@/modules/cards/domain/entities/card.entity'
import { CardKey } from '@/modules/cards/domain/value-objects/card-key.vo'

describe('PrismaCardRepository', () => {
  it('maps created row to entity', async () => {
    const prisma = {
      card: {
        create: jest.fn(async ({ data }) => ({
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          creditLimit: data.creditLimit ?? null,
        })),
      },
    } as unknown as PrismaService
    const repo = new PrismaCardRepository(prisma)
    const now = new Date()
    const card = new CardEntity(
      'c1',
      't1',
      now,
      now,
      'u1',
      'u1',
      CardKey.create('HDFC_XX9335'),
      'HDFC',
      '9335',
      null,
      17,
      null,
      CardStatus.ACTIVE,
    )
    const out = await repo.create(card)
    expect(out.id).toBe('c1')
  })
})
