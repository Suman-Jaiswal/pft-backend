import { Inject, Injectable } from '@nestjs/common'
import { Role } from '@/shared/auth/role.enum'
import { UserEntity } from '@/modules/users/domain/user.entity'
import { IUserRepository, USER_REPOSITORY } from '@/modules/users/domain/repositories/user.repository'

@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly repository: IUserRepository,
  ) {}

  async findByEmail(email: string): Promise<UserEntity | null> {
    const row = await this.repository.findByEmail(email)
    if (!row) return null
    return {
      id: row.id,
      tenantId: row.tenantId,
      email: row.email,
      passwordHash: row.passwordHash,
      role: row.role as Role,
    }
  }

  async findByGoogleSub(googleSub: string): Promise<UserEntity | null> {
    const row = await this.repository.findByGoogleSub(googleSub.trim())
    if (!row) return null
    return {
      id: row.id,
      tenantId: row.tenantId,
      email: row.email,
      passwordHash: row.passwordHash,
      role: row.role as Role,
    }
  }

  async findOrCreateGoogleUser(email: string, googleSub: string): Promise<UserEntity> {
    const normalizedEmail = email.toLowerCase()
    const normalizedGoogleSub = googleSub.trim()
    const existingBySub = await this.repository.findByGoogleSub(normalizedGoogleSub)
    if (existingBySub) {
      return {
        id: existingBySub.id,
        tenantId: existingBySub.tenantId,
        email: existingBySub.email,
        passwordHash: existingBySub.passwordHash,
        role: existingBySub.role as Role,
      }
    }

    const existingByEmail = await this.repository.findByEmail(normalizedEmail)
    // Existing users keep their current tenant mapping; attach googleSub for future stable lookups.
    if (existingByEmail) {
      const linked = await this.repository.updateGoogleSub(existingByEmail.id, normalizedGoogleSub)
      return {
        id: linked.id,
        tenantId: linked.tenantId,
        email: linked.email,
        passwordHash: linked.passwordHash,
        role: linked.role as Role,
      }
    }

    // New users: tenant is Google `sub` for stable per-account dataset mapping.
    const row = await this.repository.createGoogleUser({
      normalizedEmail,
      normalizedGoogleSub,
      role: Role.USER,
    })
    return {
      id: row.id,
      tenantId: row.tenantId,
      email: row.email,
      passwordHash: row.passwordHash,
      role: row.role as Role,
    }
  }
}
