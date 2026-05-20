import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { UpsertBillDto } from '@/modules/bills/dto/upsert-bill.dto'

@Injectable()
export class BillsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.bill.findMany({ where: { tenantId }, orderBy: { dueDay: 'asc' } })
  }

  upsert(tenantId: string, actorId: string, dto: UpsertBillDto) {
    const id = dto.id ?? `bil_${randomUUID()}`
    return this.prisma.bill.upsert({
      where: { id },
      update: {
        name: dto.name,
        amount: dto.amount,
        dueDay: dto.dueDay,
        frequency: dto.frequency ?? 'MONTHLY',
        category: dto.category ?? 'GENERAL',
        status: dto.status ?? 'ACTIVE',
        updatedBy: actorId,
      },
      create: {
        id,
        tenantId,
        name: dto.name,
        amount: dto.amount,
        dueDay: dto.dueDay,
        frequency: dto.frequency ?? 'MONTHLY',
        category: dto.category ?? 'GENERAL',
        status: dto.status ?? 'ACTIVE',
        createdBy: actorId,
        updatedBy: actorId,
      },
    })
  }

  remove(tenantId: string, id: string) {
    return this.prisma.bill.deleteMany({ where: { tenantId, id } })
  }
}
