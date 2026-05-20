import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { AuthService } from '@/modules/auth/auth.service'
import { LoginDto } from '@/modules/auth/dto/login.dto'
import { ok } from '@/shared/presentation/api-response'
import { appConfig } from '@/config/app.config'
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard'
import { Response } from 'express'

type ReqUser = {
  user: { sub: string; tenantId: string; email: string; role: string; name?: string; photoURL?: string }
}

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return ok(await this.authService.login(dto.email, dto.password))
  }

  @Get('google/start')
  async googleStart(@Query('state') state?: string) {
    return ok({ url: this.authService.getGoogleAuthUrl(state) })
  }

  @Get('google/callback')
  async googleCallback(@Query('code') code: string, @Res() res: Response) {
    const out = await this.authService.googleCallback(code)
    const redirect = `${appConfig.authSuccessRedirect}?token=${encodeURIComponent(out.accessToken)}`
    return res.redirect(redirect)
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: ReqUser) {
    return ok(req.user)
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('refresh')
  async refresh(@Req() req: ReqUser) {
    return ok(await this.authService.refresh(req.user))
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout() {
    return ok({ loggedOut: true })
  }
}
