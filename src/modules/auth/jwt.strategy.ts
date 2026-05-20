import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { appConfig } from '@/config/app.config'
import { Role } from '@/shared/auth/role.enum'

export interface AuthUser {
  sub: string
  tenantId: string
  email: string
  role: Role
  name?: string
  photoURL?: string
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: appConfig.jwtSecret,
    })
  }

  validate(payload: AuthUser): AuthUser {
    return payload
  }
}
