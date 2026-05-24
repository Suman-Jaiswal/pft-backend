import { Injectable } from '@nestjs/common'
import { ImportMessageFailure } from '@prisma/client'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import {
  ImportFailureListResult,
  ImportFailureRecord,
  ImportFailureStatus,
  ImportFailureType,
  PolledMessage,
} from '@/modules/import-jobs/types/import-contracts'

const JOB_KEY = 'cc_txn_import'
const PREVIEW_MAX_LEN = 1200

@Injectable()
export class ImportFailureService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertFailure(params: {
    bankKey: string
    message: PolledMessage
    failureType: ImportFailureType
    failureReason: string
    errorText?: string
  }): Promise<void> {
    const existing = await this.prisma.importMessageFailure.findUnique({
      where: {
        jobKey_bankKey_messageId: {
          jobKey: JOB_KEY,
          bankKey: params.bankKey,
          messageId: params.message.id,
        },
      },
    })

    const now = new Date()
    const preview =
      params.message.body.length > PREVIEW_MAX_LEN
        ? `${params.message.body.slice(0, PREVIEW_MAX_LEN)} ...[truncated]`
        : params.message.body

    if (!existing) {
      await this.prisma.importMessageFailure.create({
        data: {
          jobKey: JOB_KEY,
          bankKey: params.bankKey,
          messageId: params.message.id,
          receivedAtMs: BigInt(params.message.receivedAtMs),
          fromAddress: params.message.from || null,
          subject: params.message.subject || null,
          bodyPreview: preview || null,
          failureType: params.failureType,
          failureReason: params.failureReason,
          errorText: params.errorText ?? null,
          status: 'OPEN',
          attemptCount: 1,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      })
      return
    }

    await this.prisma.importMessageFailure.update({
      where: { id: existing.id },
      data: {
        receivedAtMs: BigInt(params.message.receivedAtMs),
        fromAddress: params.message.from || null,
        subject: params.message.subject || null,
        bodyPreview: preview || null,
        failureType: params.failureType,
        failureReason: params.failureReason,
        errorText: params.errorText ?? null,
        status: 'OPEN',
        lastSeenAt: now,
        updatedAt: now,
      },
    })
  }

  async markRetrying(id: string): Promise<void> {
    await this.prisma.importMessageFailure.update({
      where: { id },
      data: {
        status: 'RETRYING',
        attemptCount: { increment: 1 },
        lastRetriedAt: new Date(),
      },
    })
  }

  async markResolved(params: { id: string; resolvedTxnId?: string | null }): Promise<void> {
    const now = new Date()
    await this.prisma.importMessageFailure.update({
      where: { id: params.id },
      data: {
        status: 'RESOLVED',
        resolvedAt: now,
        errorText: null,
        resolvedTxnId: params.resolvedTxnId ?? null,
      },
    })
  }

  async markOpenWithError(params: { id: string; failureReason: string; errorText?: string }): Promise<void> {
    await this.prisma.importMessageFailure.update({
      where: { id: params.id },
      data: {
        status: 'OPEN',
        failureReason: params.failureReason,
        errorText: params.errorText ?? null,
        lastSeenAt: new Date(),
      },
    })
  }

  async listFailures(filters: {
    status?: ImportFailureStatus
    failureType?: ImportFailureType
    bankKeys?: string[]
    page?: number
    pageSize?: number
  }): Promise<ImportFailureListResult> {
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.max(1, Math.min(200, filters.pageSize ?? 50))
    const where = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.failureType ? { failureType: filters.failureType } : {}),
      ...(filters.bankKeys?.length ? { bankKey: { in: filters.bankKeys } } : {}),
    }

    const [total, rows] = await Promise.all([
      this.prisma.importMessageFailure.count({ where }),
      this.prisma.importMessageFailure.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return {
      items: rows.map((row) => this.mapRow(row)),
      total,
      page,
      pageSize,
    }
  }

  async getFailuresForRetry(params: {
    ids?: string[]
    bankKeys?: string[]
    limit?: number
  }): Promise<ImportMessageFailure[]> {
    const limit = Math.max(1, Math.min(1000, params.limit ?? 100))
    if (params.ids?.length) {
      return this.prisma.importMessageFailure.findMany({
        where: { id: { in: params.ids } },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: limit,
      })
    }

    return this.prisma.importMessageFailure.findMany({
      where: {
        status: { in: ['OPEN', 'RETRYING'] },
        ...(params.bankKeys?.length ? { bankKey: { in: params.bankKeys } } : {}),
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    })
  }

  private mapRow(row: ImportMessageFailure): ImportFailureRecord {
    return {
      id: row.id,
      jobKey: row.jobKey,
      bankKey: row.bankKey,
      messageId: row.messageId,
      receivedAtMs: row.receivedAtMs == null ? null : Number(row.receivedAtMs),
      fromAddress: row.fromAddress,
      subject: row.subject,
      bodyPreview: row.bodyPreview,
      failureType: row.failureType as ImportFailureType,
      failureReason: row.failureReason,
      errorText: row.errorText,
      status: row.status as ImportFailureStatus,
      attemptCount: row.attemptCount,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      lastRetriedAt: row.lastRetriedAt?.toISOString() ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      resolvedTxnId: row.resolvedTxnId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}
