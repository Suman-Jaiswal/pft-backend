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
  googleSpreadsheetId: string | null
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
        googleSpreadsheetId: true,
        updatedAt: true,
        createdAt: true,
      },
    })
    return rows.map((row) => this.toListItem(row))
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
    const googleSpreadsheetId = this.normalizeSheetId(dto.googleSpreadsheetId)
    await this.assertSheetIdAvailable(tenantId, googleSpreadsheetId)

    const row = await this.prisma.scratchPad.create({
      data: {
        id: `pad_${randomUUID()}`,
        tenantId,
        name,
        sortOrder,
        workbook,
        googleSpreadsheetId,
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
    if (dto.googleSpreadsheetId !== undefined) {
      const googleSpreadsheetId = this.normalizeSheetId(dto.googleSpreadsheetId)
      await this.assertSheetIdAvailable(tenantId, googleSpreadsheetId, id)
      data.googleSpreadsheetId = googleSpreadsheetId
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

  private normalizeSheetId(value: string | null | undefined): string | null {
    if (value === undefined) return null
    if (value === null) return null
    const trimmed = value.trim()
    if (!trimmed) return null
    return trimmed
  }

  /** Each pad must link a distinct Google Sheet (null = unlinked is fine on many pads). */
  private async assertSheetIdAvailable(
    tenantId: string,
    googleSpreadsheetId: string | null,
    excludePadId?: string,
  ): Promise<void> {
    if (!googleSpreadsheetId) return
    const clash = await this.prisma.scratchPad.findFirst({
      where: {
        tenantId,
        googleSpreadsheetId,
        ...(excludePadId ? { id: { not: excludePadId } } : {}),
      },
      select: { id: true, name: true },
    })
    if (clash) {
      throw new BadRequestException(
        `That Google Sheet is already linked to “${clash.name}”. Use a different sheet for this pad.`,
      )
    }
  }

  private toListItem(row: {
    id: string
    name: string
    sortOrder: number
    googleSpreadsheetId: string | null
    updatedAt: Date
    createdAt: Date
  }): ScratchPadListItem {
    return {
      id: row.id,
      name: row.name,
      sortOrder: row.sortOrder,
      googleSpreadsheetId: row.googleSpreadsheetId,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }
  }

  private toDetail(row: {
    id: string
    name: string
    sortOrder: number
    googleSpreadsheetId: string | null
    workbook: Prisma.JsonValue
    updatedAt: Date
    createdAt: Date
  }): ScratchPadDetail {
    return {
      ...this.toListItem(row),
      workbook: this.asObject(row.workbook),
    }
  }

  private asObject(value: Prisma.JsonValue): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    return {}
  }
}
