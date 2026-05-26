import { ApiProperty } from '@nestjs/swagger'
import { IsObject, IsString } from 'class-validator'

export class CreatePftBaselineDto {
  @ApiProperty()
  @IsString()
  periodKey!: string

  @ApiProperty()
  @IsString()
  source!: string

  @ApiProperty()
  @IsString()
  lockedBy!: string

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  metrics!: Record<string, unknown>
}
