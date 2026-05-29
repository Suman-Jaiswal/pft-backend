import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import {
  IBillRepository,
  BillUpsertInput,
} from '@/modules/bills/domain/repositories/bill.repository'

@Injectable()
export class PrismaBillRepository implements IBillRepository {
  constructor(private readonly prisma: PrismaService) {}

  listByTenant(tenantId: string) {
    return this.prisma.bill.findMany({ where: { tenantId }, orderBy: { dueDay: 'asc' } })
  }

  upsert(input: BillUpsertInput) {
    return this.prisma.bill.upsert({
      where: { id: input.id },
      update: {
        name: input.name,
        amount: input.amount,
        dueDay: input.dueDay,
        frequency: input.frequency,
        category: input.category,
        status: input.status,
        updatedBy: input.actorId,
      },
      create: {
        id: input.id,
        tenantId: input.tenantId,
        name: input.name,
        amount: input.amount,
        dueDay: input.dueDay,
        frequency: input.frequency,
        category: input.category,
        status: input.status,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      },
    })
  }

  async removeByTenantAndId(tenantId: string, id: string): Promise<number> {
    const result = await this.prisma.bill.deleteMany({ where: { tenantId, id } })
    return result.count
  }
}
