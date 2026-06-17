import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator'

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

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  fullCardNumber?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  cvv?: string

  @ApiPropertyOptional({ example: '12/28' })
  @IsString()
  @Matches(/^\d{2}\/\d{2}$/)
  @IsOptional()
  expiryDate?: string

  @ApiPropertyOptional({ example: 'Millennia' })
  @IsString()
  @IsOptional()
  variant?: string
}
