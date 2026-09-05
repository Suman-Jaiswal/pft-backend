import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, IsNumber, IsOptional, IsPositive, Min } from 'class-validator'

export class BreakFdDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number

  /** Packet denomination to break; omit to consume the oldest packets regardless of size. */
  @ApiPropertyOptional({ description: 'Packet amount to break (oldest-first when omitted)' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number
}
