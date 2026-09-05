import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString } from 'class-validator'

export class UpsertGoalDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string

  @ApiProperty()
  @IsString()
  name!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  targetAmount?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deadline?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  priority?: number

  @ApiPropertyOptional({ enum: ['ACTIVE', 'COMPLETED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'COMPLETED'])
  status?: 'ACTIVE' | 'COMPLETED'
}
