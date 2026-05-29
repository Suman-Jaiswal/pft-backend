import type { Role } from '@/shared/auth/role.enum'
import type { User } from '@prisma/client'

export const USER_REPOSITORY = Symbol('USER_REPOSITORY')

export interface IUserRepository {
  findByEmail(email: string): Promise<User | null>
  findByGoogleSub(googleSub: string): Promise<User | null>
  updateGoogleSub(userId: string, googleSub: string): Promise<User>
  createGoogleUser(input: {
    normalizedEmail: string
    normalizedGoogleSub: string
    role: Role
  }): Promise<User>
}
