import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { AuthService } from '@/modules/auth/auth.service'
import { GoogleCallbackQueryDto } from '@/modules/auth/dto/google-callback.query.dto'
import { GoogleStartQueryDto } from '@/modules/auth/dto/google-start.query.dto'
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
  async googleStart(@Query() query: GoogleStartQueryDto) {
    return ok({ url: this.authService.getGoogleAuthUrl(query.state) })
  }

  @Get('google/import/start')
  googleImportStart(@Query() query: GoogleStartQueryDto, @Res() res: Response) {
    const url = this.authService.getGoogleImportAuthUrl(query.state)
    return res.redirect(url)
  }

  @Get('google/callback')
  async googleCallback(@Query() query: GoogleCallbackQueryDto, @Res() res: Response) {
    const out = await this.authService.googleCallback(query.code)
    const redirect = `${appConfig.authSuccessRedirect}?token=${encodeURIComponent(out.accessToken)}`
    return res.redirect(redirect)
  }

  @Get('google/import/callback')
  async googleImportCallback(
    @Query() query: GoogleCallbackQueryDto,
    @Res() res: Response,
  ) {
    const targetBase = this.resolveImportReauthTarget(query.state)
    try {
      await this.authService.googleImportCallback(query.code)
      return res.redirect(`${targetBase}?reauth=success`)
    } catch (error) {
      const message = encodeURIComponent(error instanceof Error ? error.message : 'Re-auth failed')
      return res.redirect(`${targetBase}?reauth=error&message=${message}`)
    }
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

  private resolveImportReauthTarget(rawState?: string): string {
    if (!rawState) return appConfig.importReauthSuccessRedirect
    const decoded = decodeURIComponent(rawState)
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) return decoded
    if (decoded.startsWith('/')) {
      const base = appConfig.importReauthSuccessRedirect.replace(/\/+$/, '')
      return `${base}${decoded}`
    }
    return appConfig.importReauthSuccessRedirect
  }
}
