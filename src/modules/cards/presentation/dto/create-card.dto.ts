import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator'

export class CreateCardDto {
  @ApiProperty()
  @IsString()
  cardKey!: string

  @ApiProperty()
  @IsString()
  issuer!: string

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
}
