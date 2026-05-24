import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class RebaseWatermarkDto {
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number

  @ApiPropertyOptional({ type: [String], description: 'Rebase only selected bank keys' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bankKeys?: string[]

  @ApiPropertyOptional({ default: false, description: 'Preview updates without writing watermark state' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean
}
