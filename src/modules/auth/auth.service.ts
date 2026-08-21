import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { createHash, randomBytes } from 'crypto'
import { UsersService } from '@/modules/users/users.service'
import { appConfig } from '@/config/app.config'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  private async sign(user: {
    id: string
    tenantId: string
    email: string
    role: string
    name?: string
    photoURL?: string
  }): Promise<{ accessToken: string }> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
      name: user.name,
      photoURL: user.photoURL,
    })
    return { accessToken }
  }

  async login(email: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.usersService.findByEmail(email)
    if (!user) throw new UnauthorizedException('Invalid credentials')
    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) throw new UnauthorizedException('Invalid credentials')
    const signed = await this.sign(user)
    const refreshToken = await this.createRefreshSession(user.id)
    return { ...signed, refreshToken }
  }

  getGoogleAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: appConfig.googleClientId,
      redirect_uri: appConfig.googleRedirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'consent',
    })
    if (state) params.set('state', state)
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  }

  getGoogleImportAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: appConfig.googleClientId,
      redirect_uri: appConfig.importGoogleRedirectUri,
      response_type: 'code',
      scope: appConfig.importGmailScope,
      access_type: 'offline',
      prompt: 'consent',
    })
    if (state) params.set('state', state)
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  }

  async googleCallback(code: string): Promise<{ accessToken: string; email: string; refreshToken: string }> {
    const tokenJson = await this.exchangeGoogleCode(code, appConfig.googleRedirectUri)
    const profile = await this.resolveGoogleProfile(tokenJson)

    if (!profile.sub) throw new UnauthorizedException('Google subject missing')
    if (!profile.email) throw new UnauthorizedException('Google email missing')

    const normalizedEmail = profile.email.toLowerCase()
    const normalizedGoogleSub = profile.sub.trim()
    const existingBySub = await this.usersService.findByGoogleSub(normalizedGoogleSub)
    const existingByEmail = existingBySub ? null : await this.usersService.findByEmail(normalizedEmail)

    const user = await this.usersService.findOrCreateGoogleUser(profile.email, profile.sub)
    this.logger.log(
      `[GOOGLE_CALLBACK_USER] email=${normalizedEmail} sub=${normalizedGoogleSub} result=${
        existingBySub ? 'found_by_sub' : existingByEmail ? 'linked_by_email' : 'created_new'
      } userId=${user.id} tenantId=${user.tenantId}`,
    )
    const signed = await this.sign({
      ...user,
      name: profile.name,
      photoURL: profile.picture,
    })
    const refreshToken = await this.createRefreshSession(user.id)
    return { ...signed, email: user.email, refreshToken }
  }

  async googleImportCallback(code: string): Promise<{ tenantId: string; email: string }> {
    const tokenJson = await this.exchangeGoogleCode(code, appConfig.importGoogleRedirectUri)
    if (!tokenJson.refresh_token) {
      throw new UnauthorizedException(
        'Google did not return a refresh token. Re-consent with prompt=consent and offline access.',
      )
    }
    const profile = await this.resolveGoogleProfile(tokenJson)
    if (!profile.sub) throw new UnauthorizedException('Google subject missing')
    if (!profile.email) throw new UnauthorizedException('Google email missing')

    const user = await this.usersService.findOrCreateGoogleUser(profile.email, profile.sub)
    await this.upsertImportGmailCredential({
      tenantId: user.tenantId,
      actor: `google:${profile.email.toLowerCase()}`,
      refreshToken: tokenJson.refresh_token,
      email: profile.email,
      scope: tokenJson.scope ?? appConfig.importGmailScope,
    })
    return { tenantId: user.tenantId, email: profile.email }
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const { user, nextRefreshToken } = await this.rotateRefreshSession(refreshToken)
    const signed = await this.sign({
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    })
    return { ...signed, refreshToken: nextRefreshToken }
  }

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) return
    await this.prisma.authRefreshSession.updateMany({
      where: { tokenHash: this.hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  private async exchangeGoogleCode(
    code: string,
    redirectUri: string,
  ): Promise<{ access_token?: string; id_token?: string; refresh_token?: string; scope?: string }> {
    let tokenRes: Response
    try {
      tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: appConfig.googleClientId,
          client_secret: appConfig.googleClientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      })
    } catch {
      throw new UnauthorizedException('Google token exchange failed (network)')
    }
    if (!tokenRes.ok) throw new UnauthorizedException('Google token exchange failed')
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string
      id_token?: string
      refresh_token?: string
      scope?: string
    }
    if (!tokenJson.access_token) throw new UnauthorizedException('Google token missing')
    return tokenJson
  }

  private async resolveGoogleProfile(tokenJson: {
    access_token?: string
    id_token?: string
  }): Promise<{ sub?: string; email?: string; name?: string; picture?: string }> {
    let profile: { sub?: string; email?: string; name?: string; picture?: string } = {}
    if (tokenJson.id_token) {
      try {
        const [, payload] = tokenJson.id_token.split('.')
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
        const decoded = Buffer.from(normalized, 'base64').toString('utf8')
        const parsed = JSON.parse(decoded) as {
          sub?: string
          email?: string
          name?: string
          picture?: string
        }
        profile = {
          sub: parsed.sub,
          email: parsed.email,
          name: parsed.name,
          picture: parsed.picture,
        }
      } catch {
        // Fall back to userinfo endpoint only if id_token parsing fails.
      }
    }

    if (!profile.email && tokenJson.access_token) {
      let profileRes: Response
      try {
        profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        })
      } catch {
        throw new UnauthorizedException('Google profile fetch failed (network)')
      }
      if (!profileRes.ok) throw new UnauthorizedException('Google profile fetch failed')
      profile = (await profileRes.json()) as { sub?: string; email?: string; name?: string; picture?: string }
    }
    return profile
  }

  private async upsertImportGmailCredential(params: {
    tenantId: string
    actor: string
    refreshToken: string
    email: string
    scope: string
  }): Promise<void> {
    const now = new Date()
    await this.prisma.pftSetting.upsert({
      where: { tenantId: params.tenantId },
      update: {
        importGmailRefreshToken: params.refreshToken,
        importGmailEmail: params.email,
        importGmailScope: params.scope,
        importGmailTokenUpdatedAt: now,
        updatedBy: params.actor,
      },
      create: {
        tenantId: params.tenantId,
        currency: 'INR',
        defaultSalary: 0,
        defaultOtherSources: 0,
        defaultRent: 0,
        defaultCook: 0,
        defaultLoanRepayment: 0,
        defaultSipMf: 0,
        defaultStocks: 0,
        defaultFd: 0,
        defaultSavings: 0,
        defaultBills: 0,
        defaultBasicExpenses: 0,
        defaultOtherExpenses: 0,
        prevLiquidBalance: 0,
        prevInvestmentBalance: 0,
        stashDeductions: 0,
        dashboardBaselineVersion: 1,
        importGmailRefreshToken: params.refreshToken,
        importGmailEmail: params.email,
        importGmailScope: params.scope,
        importGmailTokenUpdatedAt: now,
        createdBy: params.actor,
        updatedBy: params.actor,
      },
    })
  }

  private async createRefreshSession(userId: string): Promise<string> {
    const token = this.generateRefreshToken()
    const expiresAt = new Date(Date.now() + appConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000)
    await this.prisma.authRefreshSession.create({
      data: {
        userId,
        tokenHash: this.hashToken(token),
        expiresAt,
      },
    })
    return token
  }

  private async rotateRefreshSession(token: string): Promise<{
    user: { id: string; tenantId: string; email: string; role: string }
    nextRefreshToken: string
  }> {
    const tokenHash = this.hashToken(token)
    const now = new Date()
    const current = await this.prisma.authRefreshSession.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      include: { user: true },
    })
    if (!current) throw new UnauthorizedException('Invalid refresh token')

    const nextRefreshToken = this.generateRefreshToken()
    const nextExpiresAt = new Date(Date.now() + appConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000)
    await this.prisma.$transaction([
      this.prisma.authRefreshSession.update({
        where: { id: current.id },
        data: { revokedAt: now },
      }),
      this.prisma.authRefreshSession.create({
        data: {
          userId: current.userId,
          tokenHash: this.hashToken(nextRefreshToken),
          expiresAt: nextExpiresAt,
        },
      }),
    ])
    return {
      user: {
        id: current.user.id,
        tenantId: current.user.tenantId,
        email: current.user.email,
        role: current.user.role,
      },
      nextRefreshToken,
    }
  }

  private generateRefreshToken(): string {
    return randomBytes(48).toString('base64url')
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }
}
