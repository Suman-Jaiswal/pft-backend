import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { UsersService } from '@/modules/users/users.service'
import { appConfig } from '@/config/app.config'

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
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

  async login(email: string, password: string): Promise<{ accessToken: string }> {
    const user = await this.usersService.findByEmail(email)
    if (!user) throw new UnauthorizedException('Invalid credentials')
    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) throw new UnauthorizedException('Invalid credentials')
    return this.sign(user)
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

  async googleCallback(code: string): Promise<{ accessToken: string; email: string }> {
    let tokenRes: Response
    try {
      tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: appConfig.googleClientId,
          client_secret: appConfig.googleClientSecret,
          redirect_uri: appConfig.googleRedirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      })
    } catch {
      throw new UnauthorizedException('Google token exchange failed (network)')
    }
    if (!tokenRes.ok) throw new UnauthorizedException('Google token exchange failed')
    const tokenJson = (await tokenRes.json()) as { access_token?: string; id_token?: string }
    if (!tokenJson.access_token) throw new UnauthorizedException('Google token missing')

    let profile: { sub?: string; email?: string; name?: string; picture?: string } = {}
    if (tokenJson.id_token) {
      try {
        const [, payload] = tokenJson.id_token.split('.')
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
        const decoded = Buffer.from(normalized, 'base64').toString('utf8')
        const parsed = JSON.parse(decoded) as { sub?: string; email?: string; name?: string; picture?: string }
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

    if (!profile.email) {
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

    if (!profile.sub) throw new UnauthorizedException('Google subject missing')
    if (!profile.email) throw new UnauthorizedException('Google email missing')
    const user = await this.usersService.findOrCreateGoogleUser(profile.email, profile.sub)
    return {
      ...(await this.sign({
        ...user,
        name: profile.name,
        photoURL: profile.picture,
      })),
      email: user.email,
    }
  }

  async refresh(payload: {
    sub: string
    tenantId: string
    email: string
    role: string
    name?: string
    photoURL?: string
  }) {
    return this.sign({
      id: payload.sub,
      tenantId: payload.tenantId,
      email: payload.email,
      role: payload.role,
      name: payload.name,
      photoURL: payload.photoURL,
    })
  }
}
