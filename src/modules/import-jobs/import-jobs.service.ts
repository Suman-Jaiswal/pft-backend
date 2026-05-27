import { Injectable } from '@nestjs/common'
import { CcTxnImportService } from '@/modules/import-jobs/services/cc-txn-import.service'
import { ImportLockService } from '@/modules/import-jobs/services/import-lock.service'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import {
  CcTxnImportStatus,
  ImportFailureListResult,
  ImportFailureRetryResult,
  ImportFailureStatus,
  ImportFailureType,
  ImportRunSummary,
  WatermarkRebaseResult,
} from '@/modules/import-jobs/types/import-contracts'

const JOB_KEY = 'cc_txn_import'
const LOCK_TTL_MS = 20 * 60 * 1000

@Injectable()
export class ImportJobsService {
  constructor(
    private readonly lockService: ImportLockService,
    private readonly ccTxnImportService: CcTxnImportService,
    private readonly prisma: PrismaService,
  ) {}

  async runCcTxnImport(options: {
    dryRun?: boolean
    bankKeys?: string[]
    owner: string
  }): Promise<ImportRunSummary> {
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
    status?: ImportFailureStatus
    failureType?: ImportFailureType
    bankKeys?: string[]
    page?: number
    pageSize?: number
  }): Promise<ImportFailureListResult> {
    return this.ccTxnImportService.listFailures(options)
  }

  async retryCcTxnFailures(options: {
    ids?: string[]
    bankKeys?: string[]
    limit?: number
    dryRun?: boolean
  }): Promise<ImportFailureRetryResult> {
    return this.ccTxnImportService.retryFailures(options)
  }

  async rebaseCcTxnImportWatermark(options: {
    days?: number
    bankKeys?: string[]
    dryRun?: boolean
  }): Promise<WatermarkRebaseResult> {
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
}
