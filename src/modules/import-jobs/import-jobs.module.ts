import { Module } from '@nestjs/common'
import { ImportJobsController } from '@/modules/import-jobs/import-jobs.controller'
import { ImportJobsService } from '@/modules/import-jobs/import-jobs.service'
import { CcTxnImportService } from '@/modules/import-jobs/services/cc-txn-import.service'
import { GmailPollService } from '@/modules/import-jobs/services/gmail-poll.service'
import { ImportAlertService } from '@/modules/import-jobs/services/import-alert.service'
import { ImportLockService } from '@/modules/import-jobs/services/import-lock.service'
import { ImportFailureService } from '@/modules/import-jobs/services/import-failure.service'
import { CcStatementsImportService } from '@/modules/import-jobs/services/cc-statements-import.service'
import { HdfcParser } from '@/modules/import-jobs/parsers/hdfc.parser'
import { IciciParser } from '@/modules/import-jobs/parsers/icici.parser'
import { SbiParser } from '@/modules/import-jobs/parsers/sbi.parser'

@Module({
  controllers: [ImportJobsController],
  providers: [
    ImportJobsService,
    CcTxnImportService,
    GmailPollService,
    ImportAlertService,
    ImportLockService,
    ImportFailureService,
    CcStatementsImportService,
    SbiParser,
    HdfcParser,
    IciciParser,
  ],
})
export class ImportJobsModule {}
