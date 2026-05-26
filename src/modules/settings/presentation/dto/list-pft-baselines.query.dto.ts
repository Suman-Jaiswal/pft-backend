import { ApiProperty } from '@nestjs/swagger'
import { IsString } from 'class-validator'

export class ListPftBaselinesQueryDto {
  @ApiProperty()
  @IsString()
  periodKey!: string
}
