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
import { SCOPES_KEY } from '../decorators/roles.decorator';

/**
 * @deprecated MVP usa SOLO @Roles (ver `RolesGuard` y
 * `docs/adr/0003-rbac-roles-only-mvp.md`).
 *
 * En Fase 2, cuando se habiliten scopes OAuth2 con un Pre Token Generation
 * Lambda en Cognito y una API pública con clientes terceros, este guard se
 * registrará junto a `RolesGuard` (probablemente como APP_GUARD adicional).
 * Hoy NO está registrado en ningún `@UseGuards(...)` ni en `APP_GUARD`.
 *
 * Mantener este archivo por:
 *  1. Documentar la intención arquitectónica.
 *  2. Tests existentes en `roles.guard.spec.ts` ejercitan SCOPES_KEY; cuando
 *     se separen, este guard será el dueño de esa lógica.
 *  3. Reactivación rápida en Fase 2 sin re-diseñar.
 */
@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScopes = this.reflector.getAllAndOverride<string[] | undefined>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredScopes || requiredScopes.length === 0) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest & { user?: AuthUser }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException('Missing auth context');

    const ok = requiredScopes.every((s) => user.scopes.includes(s) || user.scopes.includes('*'));
    if (!ok) throw new ForbiddenException('Scope not allowed');
    return true;
  }
}
