import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UnauthorizedException } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { ok } from '@/shared/presentation/api-response'
import { ImportJobsService } from '@/modules/import-jobs/import-jobs.service'
import { RunCcTxnImportDto } from '@/modules/import-jobs/dto/run-cc-txn-import.dto'

@ApiTags('import-jobs')
@Controller({ path: 'import-jobs', version: '1' })
export class ImportJobsController {
  constructor(private readonly importJobsService: ImportJobsService) {}

  @Post('cc-txn-import')
  @HttpCode(HttpStatus.OK)
  async runCcTxnImport(
    @Body() dto: RunCcTxnImportDto,
    @Headers('x-job-token') token?: string,
  ) {
    const expectedToken = process.env.IMPORT_JOB_TOKEN ?? ''
    if (expectedToken && token !== expectedToken) {
      throw new UnauthorizedException('Invalid X-Job-Token')
    }

    const owner = `api:${Date.now()}`
    const result = await this.importJobsService.runCcTxnImport({
      dryRun: dto.dryRun,
      bankKeys: dto.bankKeys,
      owner,
    })
    return ok(result)
  }
}
