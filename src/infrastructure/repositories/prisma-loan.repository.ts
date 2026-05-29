import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import {
  ILoanRepository,
  LoanUpsertInput,
} from '@/modules/loans/domain/repositories/loan.repository'

@Injectable()
export class PrismaLoanRepository implements ILoanRepository {
  constructor(private readonly prisma: PrismaService) {}

  listByTenant(tenantId: string) {
    return this.prisma.loan.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } })
  }

  upsert(input: LoanUpsertInput) {
    return this.prisma.loan.upsert({
      where: { id: input.id },
      update: {
        name: input.name,
        principal: input.principal,
        emi: input.emi,
        rate: input.rate,
        startDate: input.startDate,
        tenureMonths: input.tenureMonths,
        status: input.status,
        updatedBy: input.actorId,
      },
      create: {
        id: input.id,
        tenantId: input.tenantId,
        name: input.name,
        principal: input.principal,
        emi: input.emi,
        rate: input.rate,
        startDate: input.startDate,
        tenureMonths: input.tenureMonths,
        status: input.status,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      },
    })
  }

  async transitionStatus(tenantId: string, actorId: string, id: string, status: string): Promise<number> {
    const result = await this.prisma.loan.updateMany({
      where: { tenantId, id },
      data: { status, updatedBy: actorId },
    })
    return result.count
  }

  async removeByTenantAndId(tenantId: string, id: string): Promise<number> {
    const result = await this.prisma.loan.deleteMany({ where: { tenantId, id } })
    return result.count
  }
}
