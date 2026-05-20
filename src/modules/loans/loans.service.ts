import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { UpsertLoanDto } from '@/modules/loans/dto/upsert-loan.dto'

@Injectable()
export class LoansService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.loan.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } })
  }

  upsert(tenantId: string, actorId: string, dto: UpsertLoanDto) {
    const id = dto.id ?? `lon_${randomUUID()}`
    return this.prisma.loan.upsert({
      where: { id },
      update: {
        name: dto.name,
        principal: dto.principal,
        emi: dto.emi,
        rate: dto.rate ?? 0,
        startDate: new Date(dto.startDate),
        tenureMonths: dto.tenureMonths,
        status: dto.status ?? 'ACTIVE',
        updatedBy: actorId,
      },
      create: {
        id,
        tenantId,
        name: dto.name,
        principal: dto.principal,
        emi: dto.emi,
        rate: dto.rate ?? 0,
        startDate: new Date(dto.startDate),
        tenureMonths: dto.tenureMonths,
        status: dto.status ?? 'ACTIVE',
        createdBy: actorId,
        updatedBy: actorId,
      },
    })
  }

  transitionStatus(tenantId: string, actorId: string, id: string, status: string) {
    return this.prisma.loan.updateMany({
      where: { tenantId, id },
      data: { status, updatedBy: actorId },
    })
  }

  remove(tenantId: string, id: string) {
    return this.prisma.loan.deleteMany({ where: { tenantId, id } })
  }
}
