import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { IUserRepository } from '@/modules/users/domain/repositories/user.repository'
import { Role } from '@/shared/auth/role.enum'

@Injectable()
export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } })
  }

  findByGoogleSub(googleSub: string) {
    return this.prisma.user.findUnique({ where: { googleSub } })
  }

  updateGoogleSub(userId: string, googleSub: string) {
    return this.prisma.user.update({ where: { id: userId }, data: { googleSub } })
  }

  async createGoogleUser(input: {
    normalizedEmail: string
    normalizedGoogleSub: string
    role: Role
  }) {
    return this.prisma.user.create({
      data: {
        id: `usr_${randomUUID()}`,
        tenantId: input.normalizedGoogleSub,
        googleSub: input.normalizedGoogleSub,
        email: input.normalizedEmail,
        passwordHash: 'oauth-google',
        role: input.role,
      },
    })
  }
}
