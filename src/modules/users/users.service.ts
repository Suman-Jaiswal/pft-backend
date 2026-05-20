import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { Role } from '@/shared/auth/role.enum'
import { UserEntity } from '@/modules/users/domain/user.entity'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<UserEntity | null> {
    const row = await this.prisma.user.findUnique({ where: { email } })
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
    const migrationTenantId = process.env.MIGRATION_FIRESTORE_UID?.trim()
    const migrationOwnerEmail = process.env.MIGRATION_OWNER_EMAIL?.trim().toLowerCase()
    const existingBySub = await this.prisma.user.findUnique({ where: { googleSub: normalizedGoogleSub } })
    if (existingBySub) {
      return {
        id: existingBySub.id,
        tenantId: existingBySub.tenantId,
        email: existingBySub.email,
        passwordHash: existingBySub.passwordHash,
        role: existingBySub.role as Role,
      }
    }

    const existingByEmail = await this.prisma.user.findUnique({ where: { email: normalizedEmail } })
    // Existing users keep their current tenant mapping; attach googleSub for future stable lookups.
    if (existingByEmail) {
      const linked = await this.prisma.user.update({
        where: { id: existingByEmail.id },
        data: { googleSub: normalizedGoogleSub },
      })
      return {
        id: linked.id,
        tenantId: linked.tenantId,
        email: linked.email,
        passwordHash: linked.passwordHash,
        role: linked.role as Role,
      }
    }

    // New users: tenant is Google `sub` for stable per-account dataset mapping.
    // Optional override: migrated owner email maps legacy tenant records to this Google `sub`.
    const isMigratedOwner = Boolean(
      migrationTenantId &&
        migrationOwnerEmail &&
        normalizedEmail === migrationOwnerEmail,
    )
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          id: `usr_${randomUUID()}`,
          tenantId: normalizedGoogleSub,
          googleSub: normalizedGoogleSub,
          email: normalizedEmail,
          passwordHash: 'oauth-google',
          role: Role.USER,
        },
      })

      // One-time transfer: migrated owner rebinds old migrated tenant to Google `sub`.
      if (isMigratedOwner) {
        const fromTenant = migrationTenantId!
        const toTenant = normalizedGoogleSub
        await Promise.all([
          tx.card.updateMany({ where: { tenantId: fromTenant }, data: { tenantId: toTenant } }),
          tx.statement.updateMany({ where: { tenantId: fromTenant }, data: { tenantId: toTenant } }),
          tx.transaction.updateMany({ where: { tenantId: fromTenant }, data: { tenantId: toTenant } }),
          tx.monthlyPlan.updateMany({ where: { tenantId: fromTenant }, data: { tenantId: toTenant } }),
          tx.bill.updateMany({ where: { tenantId: fromTenant }, data: { tenantId: toTenant } }),
          tx.loan.updateMany({ where: { tenantId: fromTenant }, data: { tenantId: toTenant } }),
          tx.pftSetting.updateMany({ where: { tenantId: fromTenant }, data: { tenantId: toTenant } }),
        ])
      }
      return created
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
