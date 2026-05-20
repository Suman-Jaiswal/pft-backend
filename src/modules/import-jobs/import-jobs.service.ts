import { Injectable } from '@nestjs/common'
import { CcTxnImportService } from '@/modules/import-jobs/services/cc-txn-import.service'
import { ImportLockService } from '@/modules/import-jobs/services/import-lock.service'
import { ImportRunSummary } from '@/modules/import-jobs/types/import-contracts'

const JOB_KEY = 'cc_txn_import'
const LOCK_TTL_MS = 20 * 60 * 1000

@Injectable()
export class ImportJobsService {
  constructor(
    private readonly lockService: ImportLockService,
    private readonly ccTxnImportService: CcTxnImportService,
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
}
