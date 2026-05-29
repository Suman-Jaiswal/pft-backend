import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { CcTxnImportService } from '@/modules/import-jobs/services/cc-txn-import.service'
import { CcStatementsImportService } from '@/modules/import-jobs/services/cc-statements-import.service'
import { ImportLockService } from '@/modules/import-jobs/services/import-lock.service'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import {
  CcTxnImportStatus,
  CcStatementsImportRunSnapshot,
  CcStatementsImportStartResult,
  CcStatementsImportStatus,
  ImportFailureListResult,
  ImportFailureRetryResult,
  ImportFailureStatus,
  ImportFailureType,
  ImportRunSummary,
  StatementImportRunSummary,
  WatermarkRebaseResult,
} from '@/modules/import-jobs/types/import-contracts'

const JOB_KEY = 'cc_txn_import'
const STATEMENTS_JOB_KEY = 'cc_statements_import'
const LOCK_TTL_MS = 20 * 60 * 1000

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

@Injectable()
export class ImportJobsService {
  constructor(
    private readonly lockService: ImportLockService,
    private readonly ccTxnImportService: CcTxnImportService,
    private readonly ccStatementsImportService: CcStatementsImportService,
    private readonly prisma: PrismaService,
  ) {}

  async runCcTxnImport(options: {
    tenantId: string
    dryRun?: boolean
    bankKeys?: string[]
    owner: string
  }): Promise<ImportRunSummary> {
    void options.tenantId
    const acquired = await this.lockService.acquire(JOB_KEY, options.owner, LOCK_TTL_MS)
    if (!acquired) {
      const now = new Date().toISOString()
      return {
        job: 'cc_txn_import',
        status: 'SKIPPED_LOCKED',
        startedAt: now,
        completedAt: now,
        elapsedMs: 0,
        failureCount: 0,
        aggregate: {
          messages: 0,
          messagesFromSearch: 0,
          inserted: 0,
          duplicates: 0,
          skipped: 0,
          parseMiss: 0,
          parseErrors: 0,
        },
        spendCapAlertSent: false,
        banks: [],
      }
    }

    try {
      return await this.ccTxnImportService.runImport({
        dryRun: options.dryRun,
        bankKeys: options.bankKeys,
      })
    } finally {
      await this.lockService.release(JOB_KEY, options.owner)
    }
  }

  async listCcTxnFailures(options: {
    tenantId: string
    status?: ImportFailureStatus
    failureType?: ImportFailureType
    bankKeys?: string[]
    page?: number
    pageSize?: number
  }): Promise<ImportFailureListResult> {
    void options.tenantId
    return this.ccTxnImportService.listFailures(options)
  }

  async retryCcTxnFailures(options: {
    tenantId: string
    ids?: string[]
    bankKeys?: string[]
    limit?: number
    dryRun?: boolean
  }): Promise<ImportFailureRetryResult> {
    void options.tenantId
    return this.ccTxnImportService.retryFailures(options)
  }

  async rebaseCcTxnImportWatermark(options: {
    tenantId: string
    days?: number
    bankKeys?: string[]
    dryRun?: boolean
  }): Promise<WatermarkRebaseResult> {
    void options.tenantId
    return this.ccTxnImportService.rebaseWatermark(options)
  }

  async getCcTxnImportStatus(tenantId: string): Promise<CcTxnImportStatus> {
    const [setting, run] = await Promise.all([
      this.prisma.pftSetting.findUnique({
        where: { tenantId },
        select: {
          importGmailRefreshToken: true,
          importGmailTokenUpdatedAt: true,
          importGmailEmail: true,
        },
      }),
      this.prisma.importJobRun.findFirst({
        where: { jobKey: JOB_KEY },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, status: true, payload: true },
      }),
    ])

    const hasCredential = Boolean(setting?.importGmailRefreshToken?.trim())
    const payload = (run?.payload ?? null) as
      | { errorCode?: 'REAUTH_REQUIRED'; reauthRequired?: boolean }
      | null
    const runReauthRequired =
      payload?.errorCode === 'REAUTH_REQUIRED' || payload?.reauthRequired === true
    const reason: CcTxnImportStatus['reason'] = !hasCredential
      ? 'credentials_missing'
      : runReauthRequired
        ? 'last_run_reauth_required'
        : 'none'

    return {
      reauthRequired: reason !== 'none',
      reason,
      hasCredential,
      credentialUpdatedAt: setting?.importGmailTokenUpdatedAt?.toISOString() ?? null,
      credentialEmail: setting?.importGmailEmail ?? null,
      lastRunAt: run?.createdAt?.toISOString() ?? null,
      lastRunStatus: (run?.status as ImportRunSummary['status'] | undefined) ?? null,
      lastRunErrorCode: payload?.errorCode ?? null,
    }
  }

  async startCcStatementsImport(options: {
    tenantId: string
    owner: string
    dryRun?: boolean
    cardKeys?: string[]
  }): Promise<CcStatementsImportStartResult> {
    const startedAt = new Date()
    const initialPayload: CcStatementsImportStartResult = {
      jobRunId: '',
      status: 'RUNNING',
      startedAt: startedAt.toISOString(),
    }
    const created = await this.prisma.importJobRun.create({
      data: {
        jobKey: STATEMENTS_JOB_KEY,
        status: 'RUNNING',
        payload: toJsonValue(initialPayload),
        startedAt,
        completedAt: startedAt,
      },
      select: { id: true },
    })
    const runId = created.id
    await this.prisma.importJobRun.update({
      where: { id: runId },
      data: {
        payload: toJsonValue({
          jobRunId: runId,
          status: 'RUNNING',
          startedAt: startedAt.toISOString(),
        }),
      },
    })

    void this.executeCcStatementsImportRun({
      runId,
      owner: options.owner,
      tenantId: options.tenantId,
      dryRun: options.dryRun,
      cardKeys: options.cardKeys,
    })

    return {
      jobRunId: runId,
      status: 'RUNNING',
      startedAt: startedAt.toISOString(),
    }
  }

  async getCcStatementsImportStatus(tenantId: string): Promise<CcStatementsImportStatus> {
    const [setting, run] = await Promise.all([
      this.prisma.pftSetting.findUnique({
        where: { tenantId },
        select: {
          importGmailRefreshToken: true,
          importGmailTokenUpdatedAt: true,
          importGmailEmail: true,
        },
      }),
      this.prisma.importJobRun.findFirst({
        where: { jobKey: STATEMENTS_JOB_KEY },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, status: true, payload: true },
      }),
    ])

    const hasCredential = Boolean(setting?.importGmailRefreshToken?.trim())
    const payload = (run?.payload ?? null) as
      | { errorCode?: 'REAUTH_REQUIRED'; reauthRequired?: boolean }
      | null
    const runReauthRequired =
      payload?.errorCode === 'REAUTH_REQUIRED' || payload?.reauthRequired === true
    const reason: CcStatementsImportStatus['reason'] = !hasCredential
      ? 'credentials_missing'
      : runReauthRequired
        ? 'last_run_reauth_required'
        : 'none'

    return {
      reauthRequired: reason !== 'none',
      reason,
      hasCredential,
      credentialUpdatedAt: setting?.importGmailTokenUpdatedAt?.toISOString() ?? null,
      credentialEmail: setting?.importGmailEmail ?? null,
      lastRunAt: run?.createdAt?.toISOString() ?? null,
      lastRunStatus: (run?.status as CcStatementsImportStatus['lastRunStatus']) ?? null,
      lastRunErrorCode: payload?.errorCode ?? null,
    }
  }

  async getCcStatementsImportRun(runId: string): Promise<CcStatementsImportRunSnapshot | null> {
    const row = await this.prisma.importJobRun.findFirst({
      where: { id: runId, jobKey: STATEMENTS_JOB_KEY },
      select: { id: true, status: true, createdAt: true, updatedAt: true, payload: true },
    })
    if (!row) return null
    return {
      jobRunId: row.id,
      status: row.status as CcStatementsImportRunSnapshot['status'],
      startedAt: row.createdAt.toISOString(),
      completedAt: row.status === 'RUNNING' ? null : row.updatedAt.toISOString(),
      payload: row.payload as unknown as StatementImportRunSummary | CcStatementsImportStartResult,
    }
  }

  private async executeCcStatementsImportRun(options: {
    runId: string
    owner: string
    tenantId: string
    dryRun?: boolean
    cardKeys?: string[]
  }): Promise<void> {
    const acquired = await this.lockService.acquire(STATEMENTS_JOB_KEY, options.owner, LOCK_TTL_MS)
    if (!acquired) {
      const now = new Date().toISOString()
      await this.prisma.importJobRun.update({
        where: { id: options.runId },
        data: {
          status: 'SKIPPED_LOCKED',
          payload: toJsonValue({
            job: 'cc_statements_import',
            status: 'SKIPPED_LOCKED',
            startedAt: now,
            completedAt: now,
            elapsedMs: 0,
            runMonth: now.slice(0, 7),
            failureCount: 0,
            aggregate: { inserted: 0, updated: 0, skipped: 0, failed: 0 },
            cards: [],
          } satisfies StatementImportRunSummary),
        },
      })
      return
    }

    try {
      const summary = await this.ccStatementsImportService.runImport({
        tenantId: options.tenantId,
        dryRun: options.dryRun,
        cardKeys: options.cardKeys,
      })
      await this.prisma.importJobRun.update({
        where: { id: options.runId },
        data: {
          status: summary.status,
          payload: toJsonValue(summary),
        },
      })
    } catch (error) {
      const now = new Date().toISOString()
      const errorText = error instanceof Error ? error.message : String(error)
      await this.prisma.importJobRun.update({
        where: { id: options.runId },
        data: {
          status: 'FAILURE',
          payload: toJsonValue({
            job: 'cc_statements_import',
            status: 'FAILURE',
            startedAt: now,
            completedAt: now,
            elapsedMs: 0,
            runMonth: now.slice(0, 7),
            failureCount: 1,
            aggregate: { inserted: 0, updated: 0, skipped: 0, failed: 1 },
            cards: [
              {
                cardKey: 'N/A',
                labelName: 'N/A',
                flow: 'direct',
                inserted: 0,
                updated: 0,
                skipped: 0,
                failed: 1,
                summary: `Run failed: ${errorText}`,
                error: errorText,
              },
            ],
          } satisfies StatementImportRunSummary),
        },
      })
    } finally {
      await this.lockService.release(STATEMENTS_JOB_KEY, options.owner)
    }
  }
}
