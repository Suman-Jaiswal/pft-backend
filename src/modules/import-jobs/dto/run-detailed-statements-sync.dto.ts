import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator'

export class RunDetailedStatementsSyncDto {
  @ApiPropertyOptional({ description: 'Dry-run mode: parse only, no DB writes' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean

  @ApiPropertyOptional({ description: 'Run only selected card keys', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cardKeys?: string[]

  @ApiPropertyOptional({
    description:
      'When true, auto-create missing card keys before sync. Defaults to false for API calls.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  bypassCardLookup?: boolean
}
