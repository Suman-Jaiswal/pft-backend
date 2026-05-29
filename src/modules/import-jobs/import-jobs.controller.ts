import {
  Req,
  Body,
  Controller,
  Get,
  UseGuards,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Param,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ok } from '@/shared/presentation/api-response'
import { ImportJobsService } from '@/modules/import-jobs/import-jobs.service'
import { RunCcTxnImportDto } from '@/modules/import-jobs/dto/run-cc-txn-import.dto'
import { RunCcStatementsImportDto } from '@/modules/import-jobs/dto/run-cc-statements-import.dto'
import { ListCcTxnFailuresDto } from '@/modules/import-jobs/dto/list-cc-txn-failures.dto'
import { RetryCcTxnFailuresDto } from '@/modules/import-jobs/dto/retry-cc-txn-failures.dto'
import { RebaseWatermarkDto } from '@/modules/import-jobs/dto/rebase-watermark.dto'
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard'

@ApiTags('import-jobs')
@Controller({ path: 'import-jobs', version: '1' })
export class ImportJobsController {
  constructor(private readonly importJobsService: ImportJobsService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('cc-txn-import/status')
  @HttpCode(HttpStatus.OK)
  async getCcTxnImportStatus(
    @Req() req: { user: { tenantId: string } },
  ) {
    const result = await this.importJobsService.getCcTxnImportStatus(req.user.tenantId)
    return ok(result)
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('cc-statements-import/status')
  @HttpCode(HttpStatus.OK)
  async getCcStatementsImportStatus(
    @Req() req: { user: { tenantId: string } },
  ) {
    const result = await this.importJobsService.getCcStatementsImportStatus(req.user.tenantId)
    return ok(result)
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('cc-statements-import')
  @HttpCode(HttpStatus.OK)
  async startCcStatementsImport(
    @Req() req: { user: { tenantId: string; sub: string } },
    @Body() dto: RunCcStatementsImportDto,
  ) {
    const owner = `jwt:${req.user.sub}:${Date.now()}`
    const result = await this.importJobsService.startCcStatementsImport({
      tenantId: req.user.tenantId,
      owner,
      dryRun: dto.dryRun,
      cardKeys: dto.cardKeys,
    })
    return ok(result)
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('cc-statements-import/runs/:id')
  @HttpCode(HttpStatus.OK)
  async getCcStatementsImportRun(@Param('id') runId: string) {
    const result = await this.importJobsService.getCcStatementsImportRun(runId)
    if (!result) throw new NotFoundException('Import run not found')
    return ok(result)
  }

  @Post('cc-txn-import')
  @HttpCode(HttpStatus.OK)
  async runCcTxnImport(
    @Body() dto: RunCcTxnImportDto,
    @Headers('x-job-token') token?: string,
  ) {
    this.ensureJobToken(token)

    const owner = `api:${Date.now()}`
    const result = await this.importJobsService.runCcTxnImport({
      dryRun: dto.dryRun,
      bankKeys: dto.bankKeys,
      owner,
    })
    return ok(result)
  }

  @Get('cc-txn-failures')
  @HttpCode(HttpStatus.OK)
  async listCcTxnFailures(
    @Query() dto: ListCcTxnFailuresDto,
    @Headers('x-job-token') token?: string,
  ) {
    this.ensureJobToken(token)

    const result = await this.importJobsService.listCcTxnFailures({
      status: dto.status,
      failureType: dto.failureType,
      bankKeys: dto.bankKeys,
      page: dto.page,
      pageSize: dto.pageSize,
    })
    return ok(result)
  }

  @Post('cc-txn-failures/retry')
  @HttpCode(HttpStatus.OK)
  async retryCcTxnFailures(
    @Body() dto: RetryCcTxnFailuresDto,
    @Headers('x-job-token') token?: string,
  ) {
    this.ensureJobToken(token)
    const result = await this.importJobsService.retryCcTxnFailures({
      ids: dto.ids,
      bankKeys: dto.bankKeys,
      limit: dto.limit,
      dryRun: dto.dryRun,
    })
    return ok(result)
  }

  @Post('cc-txn-import/rebase-watermark')
  @HttpCode(HttpStatus.OK)
  async rebaseCcTxnImportWatermark(
    @Body() dto: RebaseWatermarkDto,
    @Headers('x-job-token') token?: string,
  ) {
    this.ensureJobToken(token)
    const result = await this.importJobsService.rebaseCcTxnImportWatermark({
      days: dto.days,
      bankKeys: dto.bankKeys,
      dryRun: dto.dryRun,
    })
    return ok(result)
  }

  private ensureJobToken(token?: string): void {
    const expectedToken = process.env.IMPORT_JOB_TOKEN ?? ''
    if (expectedToken && token !== expectedToken) {
      throw new UnauthorizedException('Invalid X-Job-Token')
    }
  }
}
