import { Role } from '@/shared/auth/role.enum'

export interface UserEntity {
  id: string
  tenantId: string
  email: string
  passwordHash: string
  role: Role
}
