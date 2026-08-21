import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Param,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common'
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger'
import { ok } from '@/shared/presentation/api-response'
import { ImportJobsService } from '@/modules/import-jobs/import-jobs.service'
import { RunCcTxnImportDto } from '@/modules/import-jobs/dto/run-cc-txn-import.dto'
import { RunCcStatementsImportDto } from '@/modules/import-jobs/dto/run-cc-statements-import.dto'
import { ListCcTxnFailuresDto } from '@/modules/import-jobs/dto/list-cc-txn-failures.dto'
import { RetryCcTxnFailuresDto } from '@/modules/import-jobs/dto/retry-cc-txn-failures.dto'
import { RebaseWatermarkDto } from '@/modules/import-jobs/dto/rebase-watermark.dto'
import { RunDetailedStatementsSyncDto } from '@/modules/import-jobs/dto/run-detailed-statements-sync.dto'
import { ListDetailedStatementsDto } from '@/modules/import-jobs/dto/list-detailed-statements.dto'

@ApiTags('import-jobs')
@Controller({ path: 'import-jobs', version: '1' })
export class ImportJobsController {
  constructor(private readonly importJobsService: ImportJobsService) {}

  @Get('cc-txn-import/status')
  @ApiOperation({ summary: 'CC txn import status [AUTH: X-Job-Token + X-Tenant-Id]' })
  @ApiSecurity('job-token')
  @ApiSecurity('tenant-id')
  @HttpCode(HttpStatus.OK)
  async getCcTxnImportStatus(
    @Headers('x-job-token') token?: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    this.ensureJobToken(token)
    const result = await this.importJobsService.getCcTxnImportStatus(this.requireTenantId(tenantId))
    return ok(result)
  }

  @Get('cc-statements-import/status')
  @ApiOperation({ summary: 'CC statements import status [AUTH: X-Job-Token + X-Tenant-Id]' })
  @ApiSecurity('job-token')
  @ApiSecurity('tenant-id')
  @HttpCode(HttpStatus.OK)
  async getCcStatementsImportStatus(
    @Headers('x-job-token') token?: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    this.ensureJobToken(token)
    const result = await this.importJobsService.getCcStatementsImportStatus(this.requireTenantId(tenantId))
    return ok(result)
  }

  @Post('cc-statements-import')
  @ApiOperation({ summary: 'Start CC statements import [AUTH: X-Job-Token + X-Tenant-Id]' })
  @ApiSecurity('job-token')
  @ApiSecurity('tenant-id')
  @HttpCode(HttpStatus.OK)
  async startCcStatementsImport(
    @Body() dto: RunCcStatementsImportDto,
    @Headers('x-job-token') token?: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    this.ensureJobToken(token)
    const owner = `api:${Date.now()}`
    const result = await this.importJobsService.startCcStatementsImport({
      tenantId: this.requireTenantId(tenantId),
      owner,
      dryRun: dto.dryRun,
      cardKeys: dto.cardKeys,
    })
    return ok(result)
  }

  @Get('cc-statements-import/runs/:id')
  @ApiOperation({ summary: 'Get CC statements import run [AUTH: X-Job-Token + X-Tenant-Id]' })
  @ApiSecurity('job-token')
  @ApiSecurity('tenant-id')
  @HttpCode(HttpStatus.OK)
  async getCcStatementsImportRun(
    @Param('id') runId: string,
    @Headers('x-job-token') token?: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    this.ensureJobToken(token)
    const result = await this.importJobsService.getCcStatementsImportRun(
      this.requireTenantId(tenantId),
      runId,
    )
    if (!result) throw new NotFoundException('Import run not found')
    return ok(result)
  }

  @Post('cc-txn-import')
  @ApiOperation({ summary: 'Run CC txn import [AUTH: X-Job-Token + X-Tenant-Id]' })
  @ApiSecurity('job-token')
  @ApiSecurity('tenant-id')
  @HttpCode(HttpStatus.OK)
  async runCcTxnImport(
    @Body() dto: RunCcTxnImportDto,
    @Headers('x-job-token') token?: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    this.ensureJobToken(token)
    const resolvedTenantId = this.requireTenantId(tenantId)

    const owner = `api:${Date.now()}`
    const result = await this.importJobsService.runCcTxnImport({
      tenantId: resolvedTenantId,
      dryRun: dto.dryRun,
      bankKeys: dto.bankKeys,
      owner,
    })
    return ok(result)
  }

  @Get('cc-txn-failures')
  @ApiOperation({ summary: 'List CC txn failures [AUTH: X-Job-Token + X-Tenant-Id]' })
  @ApiSecurity('job-token')
  @ApiSecurity('tenant-id')
  @HttpCode(HttpStatus.OK)
  async listCcTxnFailures(
    @Query() dto: ListCcTxnFailuresDto,
    @Headers('x-job-token') token?: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    this.ensureJobToken(token)
    const resolvedTenantId = this.requireTenantId(tenantId)

    const result = await this.importJobsService.listCcTxnFailures({
      tenantId: resolvedTenantId,
      status: dto.status,
      failureType: dto.failureType,
      bankKeys: dto.bankKeys,
      page: dto.page,
      pageSize: dto.pageSize,
    })
    return ok(result)
  }

  @Post('cc-txn-failures/retry')
  @ApiOperation({ summary: 'Retry CC txn failures [AUTH: X-Job-Token + X-Tenant-Id]' })
  @ApiSecurity('job-token')
  @ApiSecurity('tenant-id')
  @HttpCode(HttpStatus.OK)
  async retryCcTxnFailures(
    @Body() dto: RetryCcTxnFailuresDto,
    @Headers('x-job-token') token?: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    this.ensureJobToken(token)
    const resolvedTenantId = this.requireTenantId(tenantId)
    const result = await this.importJobsService.retryCcTxnFailures({
      tenantId: resolvedTenantId,
      ids: dto.ids,
      bankKeys: dto.bankKeys,
      limit: dto.limit,
      dryRun: dto.dryRun,
    })
    return ok(result)
  }

  @Post('cc-txn-import/rebase-watermark')
  @ApiOperation({ summary: 'Rebase CC txn watermark [AUTH: X-Job-Token + X-Tenant-Id]' })
  @ApiSecurity('job-token')
  @ApiSecurity('tenant-id')
  @HttpCode(HttpStatus.OK)
  async rebaseCcTxnImportWatermark(
    @Body() dto: RebaseWatermarkDto,
    @Headers('x-job-token') token?: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    this.ensureJobToken(token)
    const resolvedTenantId = this.requireTenantId(tenantId)
    const result = await this.importJobsService.rebaseCcTxnImportWatermark({
      tenantId: resolvedTenantId,
      days: dto.days,
      bankKeys: dto.bankKeys,
      dryRun: dto.dryRun,
    })
    return ok(result)
  }

  @Get('detailed-statements')
  @ApiOperation({ summary: 'List detailed statement metadata [AUTH: X-Job-Token + X-Tenant-Id]' })
  @ApiSecurity('job-token')
  @ApiSecurity('tenant-id')
  @HttpCode(HttpStatus.OK)
  async listDetailedStatements(
    @Query() dto: ListDetailedStatementsDto,
    @Headers('x-job-token') token?: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    this.ensureJobToken(token)
    const result = await this.importJobsService.listDetailedStatements({
      tenantId: this.requireTenantId(tenantId),
      cardKeys: dto.cardKeys,
      fromDate: dto.fromDate,
      toDate: dto.toDate,
      page: dto.page,
      pageSize: dto.pageSize,
    })
    return ok(result)
  }

  @Post('detailed-statements/query')
  @ApiOperation({ summary: 'Query detailed statement metadata [AUTH: X-Job-Token + X-Tenant-Id]' })
  @ApiSecurity('job-token')
  @ApiSecurity('tenant-id')
  @HttpCode(HttpStatus.OK)
  async queryDetailedStatements(
    @Body() dto: ListDetailedStatementsDto,
    @Headers('x-job-token') token?: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    this.ensureJobToken(token)
    const result = await this.importJobsService.listDetailedStatements({
      tenantId: this.requireTenantId(tenantId),
      cardKeys: dto.cardKeys,
      fromDate: dto.fromDate,
      toDate: dto.toDate,
      page: dto.page,
      pageSize: dto.pageSize,
    })
    return ok(result)
  }

  @Post('detailed-statements/sync')
  @ApiOperation({ summary: 'Run detailed statement sync [AUTH: X-Job-Token + X-Tenant-Id]' })
  @ApiSecurity('job-token')
  @ApiSecurity('tenant-id')
  @HttpCode(HttpStatus.OK)
  async runDetailedStatementsSync(
    @Body() dto: RunDetailedStatementsSyncDto,
    @Headers('x-job-token') token?: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    this.ensureJobToken(token)
    const owner = `api:${Date.now()}`
    const result = await this.importJobsService.runDetailedStatementsSync({
      tenantId: this.requireTenantId(tenantId),
      owner,
      dryRun: dto.dryRun,
      cardKeys: dto.cardKeys,
      bypassCardLookup: dto.bypassCardLookup,
    })
    return ok(result)
  }

  private ensureJobToken(token?: string): void {
    const expectedToken = process.env.IMPORT_JOB_TOKEN ?? ''
    if (expectedToken && token !== expectedToken) {
      throw new UnauthorizedException('Invalid X-Job-Token')
    }
  }

  private requireTenantId(tenantId?: string): string {
    const value = tenantId?.trim()
    if (!value) throw new UnauthorizedException('Missing X-Tenant-Id')
    return value
  }
}
