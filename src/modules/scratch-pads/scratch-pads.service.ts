import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { CreateScratchPadDto } from '@/modules/scratch-pads/dto/create-scratch-pad.dto'
import { UpdateScratchPadDto } from '@/modules/scratch-pads/dto/update-scratch-pad.dto'

export type ScratchPadListItem = {
  id: string
  name: string
  sortOrder: number
  updatedAt: string
  createdAt: string
}

export type ScratchPadDetail = ScratchPadListItem & {
  workbook: Record<string, unknown>
}

@Injectable()
export class ScratchPadsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<ScratchPadListItem[]> {
    const rows = await this.prisma.scratchPad.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        updatedAt: true,
        createdAt: true,
      },
    })
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sortOrder: row.sortOrder,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }))
  }

  async get(tenantId: string, id: string): Promise<ScratchPadDetail> {
    const row = await this.prisma.scratchPad.findFirst({
      where: { id, tenantId },
    })
    if (!row) throw new NotFoundException('Scratch pad not found.')
    return this.toDetail(row)
  }

  async create(
    tenantId: string,
    actorId: string,
    dto: CreateScratchPadDto,
  ): Promise<ScratchPadDetail> {
    const name = dto.name?.trim()
    if (!name) throw new BadRequestException('Scratch pad name is required.')

    const maxSort = await this.prisma.scratchPad.aggregate({
      where: { tenantId },
      _max: { sortOrder: true },
    })
    const sortOrder = dto.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1
    const workbook = (dto.workbook ?? {}) as Prisma.InputJsonValue

    const row = await this.prisma.scratchPad.create({
      data: {
        id: `pad_${randomUUID()}`,
        tenantId,
        name,
        sortOrder,
        workbook,
        createdBy: actorId,
        updatedBy: actorId,
      },
    })
    return this.toDetail(row)
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateScratchPadDto,
  ): Promise<ScratchPadDetail> {
    const existing = await this.prisma.scratchPad.findFirst({
      where: { id, tenantId },
      select: { id: true },
    })
    if (!existing) throw new NotFoundException('Scratch pad not found.')

    const data: Prisma.ScratchPadUpdateInput = { updatedBy: actorId }
    if (dto.name !== undefined) {
      const name = dto.name.trim()
      if (!name) throw new BadRequestException('Scratch pad name is required.')
      data.name = name
    }
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder
    if (dto.workbook !== undefined) {
      data.workbook = dto.workbook as Prisma.InputJsonValue
    }

    const row = await this.prisma.scratchPad.update({
      where: { id },
      data,
    })
    return this.toDetail(row)
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const result = await this.prisma.scratchPad.deleteMany({
      where: { id, tenantId },
    })
    if (result.count === 0) throw new NotFoundException('Scratch pad not found.')
  }

  private toDetail(row: {
    id: string
    name: string
    sortOrder: number
    workbook: Prisma.JsonValue
    updatedAt: Date
    createdAt: Date
  }): ScratchPadDetail {
    return {
      id: row.id,
      name: row.name,
      sortOrder: row.sortOrder,
      workbook: this.asObject(row.workbook),
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }
  }

  private asObject(value: Prisma.JsonValue): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    return {}
  }
}
