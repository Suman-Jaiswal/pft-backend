import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '@/shared/auth/roles.decorator'
import { Role } from '@/shared/auth/role.enum'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!requiredRoles || requiredRoles.length === 0) return true
    const req = context.switchToHttp().getRequest<{ user?: { role?: Role } }>()
    const userRole = req.user?.role
    if (!userRole) return false
    return requiredRoles.includes(userRole)
  }
}
