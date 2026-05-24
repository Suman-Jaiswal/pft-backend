import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, Min } from 'class-validator'

export class CurrentMonthlyPlanQueryDto {
  @ApiProperty({ description: 'Month number (1-12)', example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  month!: number

  @ApiProperty({ description: 'Year (4-digit)', example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  year!: number
}
