import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export interface AuthUser {
  id: string;
  cognitoSub: string;
  email: string;
  role: string;
  scopes: string[];
  mfaEnrolled: boolean;
  /**
   * MFA verificado en el token actual (`amr` claim contiene `'mfa'`, o
   * `cognito:mfa_enabled=true`). Distinto a `mfaEnrolled` (que es el flag
   * persistente del usuario en la BD). El `JwtAuthGuard` enforza esto
   * según `MFA_ENFORCEMENT` para roles admin.
   */
  mfaVerified?: boolean;
  /**
   * Cognito user-pool de origen del token validado (defensa en profundidad
   * H3). El `RolesGuard` puede usarlo para rechazar privilege escalation
   * cross-pool: un token con `custom:role=admin_segurasist` pero
   * `pool=insured` no debe poder operar como admin.
   */
  pool?: 'admin' | 'insured';
  /**
   * M2 (Bug deferred audit Sprint 1) — flag de superadmin cross-tenant.
   *
   * Lo setea `JwtAuthGuard` cuando el token es `custom:role=admin_segurasist`
   * y `pool=admin`. Indica al controller / service que debe usar
   * `PrismaBypassRlsService` (rol DB BYPASSRLS) en lugar de `PrismaService`
   * (request-scoped, NOBYPASSRLS) y que `req.tenant` NO existe (cross-tenant).
   *
   * Equivalencia con `req.bypassRls`: ambos marcadores conviven; este flag
   * vive en `AuthUser` para que los controllers decidan el path con el
   * `@CurrentUser()` decorator sin tocar `@Req()`.
   */
  platformAdmin?: boolean;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest & { user?: AuthUser }>();
  if (!req.user) {
    throw new Error('CurrentUser used without JwtAuthGuard');
  }
  return req.user;
});
