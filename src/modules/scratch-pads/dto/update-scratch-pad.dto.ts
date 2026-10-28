import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, IsObject, IsOptional, IsString, Min, MinLength } from 'class-validator'

export class UpdateScratchPadDto {
  @ApiPropertyOptional({ example: 'Scratch 1' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string

  @ApiPropertyOptional({ description: 'Univer workbook snapshot JSON' })
  @IsOptional()
  @IsObject()
  workbook?: Record<string, unknown>

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number
}
