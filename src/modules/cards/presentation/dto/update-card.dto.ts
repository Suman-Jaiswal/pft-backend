import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class UpdateCardDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  issuer?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  last4?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  network?: string

  @ApiPropertyOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  @IsOptional()
  statementCycleDay?: number

  @ApiPropertyOptional()
  @IsOptional()
  creditLimit?: number

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'CLOSED'] })
  @IsIn(['ACTIVE', 'INACTIVE', 'CLOSED'])
  @IsOptional()
  status?: 'ACTIVE' | 'INACTIVE' | 'CLOSED'
}
