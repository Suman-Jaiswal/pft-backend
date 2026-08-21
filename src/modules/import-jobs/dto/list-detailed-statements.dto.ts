import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { IsArray, IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class ListDetailedStatementsDto {
  @ApiPropertyOptional({ type: [String], description: 'Filter by card keys' })
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return value
        .flatMap((item) => String(item).split(','))
        .map((item) => item.trim())
        .filter(Boolean)
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    }
    return value
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cardKeys?: string[]

  @ApiPropertyOptional({ description: 'Start date (inclusive), YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  fromDate?: string

  @ApiPropertyOptional({ description: 'End date (inclusive), YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  toDate?: string

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number
}
