import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

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
}
