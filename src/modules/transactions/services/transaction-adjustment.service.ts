import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { AdjustmentType, roundMoney } from '@/modules/transactions/domain/effective-amount'
import { UpsertTransactionAdjustmentDto } from '@/modules/transactions/presentation/dto/upsert-transaction-adjustment.dto'

export type TransactionAdjustmentResponse = {
  id: string
  transactionId: string
  type: AdjustmentType
  personalShare: number | null
  amortizeMonths: number | null
  monthlyAmount: number | null
  note: string | null
}

@Injectable()
export class TransactionAdjustmentService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(
    tenantId: string,
    actorId: string,
    txnId: string,
    dto: UpsertTransactionAdjustmentDto,
  ): Promise<TransactionAdjustmentResponse> {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: txnId, tenantId },
      select: { id: true, amount: true },
    })
    if (!transaction) {
      throw new NotFoundException(`Transaction ${txnId} not found`)
    }

    const amount = Number(transaction.amount)
    if (dto.type === 'SPLIT') {
      const share = Number(dto.personalShare)
      if (!(share > 0 && share < amount)) {
        throw new BadRequestException('personalShare must be > 0 and < transaction amount')
      }
    }
    if (dto.type === 'AMORTIZE') {
      const n = Number(dto.amortizeMonths)
      if (!Number.isInteger(n) || n < 2 || n > 60) {
        throw new BadRequestException('amortizeMonths must be an integer between 2 and 60')
      }
    }

    const personalShare = dto.type === 'SPLIT' ? Number(dto.personalShare) : null
    const amortizeMonths = dto.type === 'AMORTIZE' ? Number(dto.amortizeMonths) : null
    const note = dto.note ?? null
    const adjustment = await this.prisma.transactionAdjustment.upsert({
      where: { transactionId: txnId },
      create: {
        tenantId,
        transactionId: txnId,
        type: dto.type,
        personalShare,
        amortizeMonths,
        note,
        createdBy: actorId,
        updatedBy: actorId,
      },
      update: {
        type: dto.type,
        personalShare,
        amortizeMonths,
        note,
        updatedBy: actorId,
      },
    })

    return {
      id: adjustment.id,
      transactionId: adjustment.transactionId,
      type: adjustment.type as AdjustmentType,
      personalShare: adjustment.personalShare == null ? null : Number(adjustment.personalShare),
      amortizeMonths: adjustment.amortizeMonths,
      monthlyAmount: dto.type === 'AMORTIZE' ? roundMoney(amount / amortizeMonths!) : null,
      note: adjustment.note,
    }
  }

  async remove(tenantId: string, txnId: string): Promise<void> {
    const adjustment = await this.prisma.transactionAdjustment.findFirst({
      where: { tenantId, transactionId: txnId },
      select: { id: true },
    })
    if (!adjustment) {
      throw new NotFoundException(`Transaction adjustment for ${txnId} not found`)
    }

    await this.prisma.transactionAdjustment.delete({ where: { id: adjustment.id } })
  }
}
