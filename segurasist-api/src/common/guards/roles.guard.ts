import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { AuthUser } from '../decorators/current-user.decorator';
import { ROLES_KEY, Role, SCOPES_KEY } from '../decorators/roles.decorator';

/**
 * Roles que SÓLO pueden venir del pool admin (defensa en profundidad H3).
 * Si el token vino del pool insured, el RolesGuard rechaza aun si el
 * `custom:role` dice lo contrario — eso bloquea privilege escalation
 * provocado por un mis-route de claims o config error en cognito-local/Cognito.
 */
const ADMIN_ONLY_ROLES: ReadonlySet<Role> = new Set<Role>([
  'admin_segurasist',
  'admin_mac',
  'operator',
  'supervisor',
]);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredScopes = this.reflector.getAllAndOverride<string[] | undefined>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if ((!requiredRoles || requiredRoles.length === 0) && (!requiredScopes || requiredScopes.length === 0)) {
      return true;
    }

    const req = context.switchToHttp().getRequest<FastifyRequest & { user?: AuthUser }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException('Missing auth context');

    // H3 — defensa en profundidad: un rol admin-only en un token del pool
    // insured indica privilege escalation. Si el guard JWT falló en pool-aware
    // o si Cognito mis-routea claims, este check lo bloquea.
    if (user.pool !== undefined && user.pool === 'insured' && ADMIN_ONLY_ROLES.has(user.role as Role)) {
      throw new ForbiddenException('Role/pool mismatch');
    }

    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(user.role as Role)) {
      throw new ForbiddenException('Role not allowed');
    }
    if (requiredScopes && requiredScopes.length > 0) {
      const ok = requiredScopes.every((s) => user.scopes.includes(s) || user.scopes.includes('*'));
      if (!ok) throw new ForbiddenException('Scope not allowed');
    }
    return true;
  }
}
