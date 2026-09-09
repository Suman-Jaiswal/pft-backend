import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsObject, IsOptional, IsString } from 'class-validator'

export class UpdatePftBaselineDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  source?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  lockedBy?: string

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  metrics!: Record<string, unknown>
}
