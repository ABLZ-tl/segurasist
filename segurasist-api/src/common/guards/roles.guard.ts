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
