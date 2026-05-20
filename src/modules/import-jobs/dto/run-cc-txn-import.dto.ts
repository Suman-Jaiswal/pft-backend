import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator'

export class RunCcTxnImportDto {
  @ApiPropertyOptional({ description: 'Dry-run mode: no writes, only stats/logs' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean

  @ApiPropertyOptional({ description: 'Run only selected bank keys', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bankKeys?: string[]
}
