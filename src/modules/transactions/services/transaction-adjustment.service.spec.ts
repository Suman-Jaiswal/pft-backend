import { BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { TransactionAdjustmentService } from '@/modules/transactions/services/transaction-adjustment.service'

describe('TransactionAdjustmentService', () => {
  const tenantId = 'tenant-1'
  const actorId = 'user-1'
  const txnId = 'txn-1'
  const transaction = { id: txnId, amount: 1_200 }
  const adjustment = {
    id: 'adj-1',
    transactionId: txnId,
    type: 'EXCLUDE',
    personalShare: null,
    amortizeMonths: null,
    note: 'Exclude this',
  }
  const prisma = {
    transaction: { findFirst: jest.fn() },
    transactionAdjustment: { upsert: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
  }
  const service = new TransactionAdjustmentService(prisma as unknown as PrismaService)

  beforeEach(() => jest.resetAllMocks())

  it('throws NotFoundException when the transaction is not found', async () => {
    prisma.transaction.findFirst.mockResolvedValue(null)

    await expect(service.upsert(tenantId, actorId, txnId, { type: 'EXCLUDE' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('throws BadRequestException when SPLIT personalShare is not less than the amount', async () => {
    prisma.transaction.findFirst.mockResolvedValue(transaction)

    await expect(
      service.upsert(tenantId, actorId, txnId, { type: 'SPLIT', personalShare: 1_200 }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('upserts an EXCLUDE adjustment and clears unused fields', async () => {
    prisma.transaction.findFirst.mockResolvedValue(transaction)
    prisma.transactionAdjustment.upsert.mockResolvedValue(adjustment)

    await expect(service.upsert(tenantId, actorId, txnId, { type: 'EXCLUDE', note: 'Exclude this' })).resolves.toEqual({
      ...adjustment,
      monthlyAmount: null,
    })
    expect(prisma.transactionAdjustment.upsert).toHaveBeenCalledWith({
      where: { transactionId: txnId },
      create: {
        tenantId,
        transactionId: txnId,
        type: 'EXCLUDE',
        personalShare: null,
        amortizeMonths: null,
        note: 'Exclude this',
        createdBy: actorId,
        updatedBy: actorId,
      },
      update: {
        type: 'EXCLUDE',
        personalShare: null,
        amortizeMonths: null,
        note: 'Exclude this',
        updatedBy: actorId,
      },
    })
  })

  it('throws NotFoundException when removing a missing adjustment', async () => {
    prisma.transactionAdjustment.findFirst.mockResolvedValue(null)

    await expect(service.remove(tenantId, txnId)).rejects.toBeInstanceOf(NotFoundException)
  })
})
