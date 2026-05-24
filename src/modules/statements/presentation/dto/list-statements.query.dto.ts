import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Min } from 'class-validator'

export class ListStatementsQueryDto {
  @ApiPropertyOptional({ description: '1-based page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number

  @ApiPropertyOptional({ description: 'Filter by card id' })
  @IsOptional()
  @IsString()
  cardId?: string

  @ApiPropertyOptional({ description: 'Filter by statement month (e.g. 2026-05)' })
  @IsOptional()
  @IsString()
  statementMonth?: string
}
