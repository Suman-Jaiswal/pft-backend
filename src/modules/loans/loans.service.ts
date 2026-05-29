import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { UpsertLoanDto } from '@/modules/loans/dto/upsert-loan.dto'
import { ILoanRepository, LOAN_REPOSITORY } from '@/modules/loans/domain/repositories/loan.repository'

@Injectable()
export class LoansService {
  constructor(
    @Inject(LOAN_REPOSITORY) private readonly repository: ILoanRepository,
  ) {}

  list(tenantId: string) {
    return this.repository.listByTenant(tenantId)
  }

  upsert(tenantId: string, actorId: string, dto: UpsertLoanDto) {
    const id = dto.id ?? `lon_${randomUUID()}`
    return this.repository.upsert({
      id,
      tenantId,
      actorId,
      name: dto.name,
      principal: dto.principal,
      emi: dto.emi,
      rate: dto.rate ?? 0,
      startDate: new Date(dto.startDate),
      tenureMonths: dto.tenureMonths,
      status: dto.status ?? 'ACTIVE',
    })
  }

  transitionStatus(tenantId: string, actorId: string, id: string, status: string) {
    return this.repository.transitionStatus(tenantId, actorId, id, status)
  }

  remove(tenantId: string, id: string) {
    return this.repository.removeByTenantAndId(tenantId, id)
  }
}
