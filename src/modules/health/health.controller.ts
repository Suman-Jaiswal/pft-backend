import { Controller, Get } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ok } from '@/shared/presentation/api-response'

@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check [AUTH: NONE]' })
  check() {
    return ok({ status: 'ok' })
  }
}
