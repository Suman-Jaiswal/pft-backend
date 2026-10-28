import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard'
import { CreateScratchPadDto } from '@/modules/scratch-pads/dto/create-scratch-pad.dto'
import { UpdateScratchPadDto } from '@/modules/scratch-pads/dto/update-scratch-pad.dto'
import { ScratchPadsService } from '@/modules/scratch-pads/scratch-pads.service'
import { Role } from '@/shared/auth/role.enum'
import { Roles } from '@/shared/auth/roles.decorator'
import { RolesGuard } from '@/shared/auth/roles.guard'
import { ok } from '@/shared/presentation/api-response'

type ReqUser = { user: { sub: string; tenantId: string } }

@ApiTags('scratch-pads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'scratch-pads', version: '1' })
export class ScratchPadsController {
  constructor(private readonly service: ScratchPadsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'List scratch pads (metadata only) [AUTH: JWT]' })
  async list(@Req() req: ReqUser) {
    return ok(await this.service.list(req.user.tenantId))
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Get scratch pad with workbook [AUTH: JWT]' })
  async get(@Req() req: ReqUser, @Param('id') id: string) {
    return ok(await this.service.get(req.user.tenantId, id))
  }

  @Post()
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Create scratch pad [AUTH: JWT]' })
  async create(@Req() req: ReqUser, @Body() dto: CreateScratchPadDto) {
    return ok(await this.service.create(req.user.tenantId, req.user.sub, dto))
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Update scratch pad [AUTH: JWT]' })
  async update(
    @Req() req: ReqUser,
    @Param('id') id: string,
    @Body() dto: UpdateScratchPadDto,
  ) {
    return ok(await this.service.update(req.user.tenantId, req.user.sub, id, dto))
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Delete scratch pad [AUTH: JWT]' })
  async remove(@Req() req: ReqUser, @Param('id') id: string) {
    await this.service.remove(req.user.tenantId, id)
    return ok(true)
  }
}
