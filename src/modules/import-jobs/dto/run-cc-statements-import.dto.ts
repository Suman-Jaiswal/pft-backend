import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator'

export class RunCcStatementsImportDto {
  @ApiPropertyOptional({ description: 'Dry-run mode: parse only, no statement writes' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean

  @ApiPropertyOptional({ description: 'Run only selected card keys', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cardKeys?: string[]
}
