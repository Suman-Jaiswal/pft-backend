import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { UpsertBillDto } from '@/modules/bills/dto/upsert-bill.dto'
import { BILL_REPOSITORY, IBillRepository } from '@/modules/bills/domain/repositories/bill.repository'

@Injectable()
export class BillsService {
  constructor(
    @Inject(BILL_REPOSITORY) private readonly repository: IBillRepository,
  ) {}

  list(tenantId: string) {
    return this.repository.listByTenant(tenantId)
  }

  upsert(tenantId: string, actorId: string, dto: UpsertBillDto) {
    const id = dto.id ?? `bil_${randomUUID()}`
    return this.repository.upsert({
      id,
      tenantId,
      actorId,
      name: dto.name,
      amount: dto.amount,
      dueDay: dto.dueDay,
      frequency: dto.frequency ?? 'MONTHLY',
      category: dto.category ?? 'GENERAL',
      status: dto.status ?? 'ACTIVE',
    })
  }

  remove(tenantId: string, id: string) {
    return this.repository.removeByTenantAndId(tenantId, id)
  }
}
