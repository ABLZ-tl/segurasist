/**
 * H-14 — Helper runtime para reforzar `PrismaBypassRlsService` (BYPASSRLS)
 * con un assertion explícito.
 *
 * Contexto del audit (`docs/audit/02-multitenant-rls-v2.md` y AUDIT_INDEX
 * H-14):
 *   - 16 callers inyectan `PrismaBypassRlsService` (rol DB
 *     `segurasist_admin` con BYPASSRLS) sin un check runtime de que el actor
 *     sea efectivamente platform admin.
 *   - El `JwtAuthGuard` ya setea `req.bypassRls=true` solo cuando el
 *     `custom:role` del Cognito pool es `admin_segurasist`, **pero** algunos
 *     paths internos (workers application-scoped, lookups pre-tenant en
 *     `AuthService`) saltan el guard. JSDoc dice "verify platformAdmin antes
 *     de usar bypass" pero NO lo enforce.
 *   - Sin este helper, una regresión en el `@Roles()` decorator de un endpoint
 *     superadmin podría dejar pasar a un `admin_mac` con un service que usa
 *     `PrismaBypassRlsService` directo → cross-tenant data leak silencioso.
 *
 * Política (ADR-0001):
 *   - **Endpoints HTTP** que usan `PrismaBypassRlsService` deben llamar
 *     `assertPlatformAdmin(req.user)` al inicio del método (después del
 *     `@Roles()` decorator — defense-in-depth).
 *   - **Workers application-scoped** (sin `req`): NO se invoca este helper
 *     (no hay actor humano). Esos paths deben tener un comentario inline
 *     justificando el uso de bypass + el filtro `tenantId` explícito en
 *     todas las queries.
 *   - **AuthService.findInsuredByCurp** (lookup pre-tenant para OTP request)
 *     es el único endpoint HTTP donde `req.user` no existe todavía. Este
 *     caso usa whitelist de IP/throttle + log estructurado en lugar de
 *     `assertPlatformAdmin`.
 *
 * El helper es deliberadamente sin dependencies (no Reflector, no Nest IoC)
 * para que pueda invocarse desde cualquier service/controller/worker sin
 * tener que inyectarlo. Se exporta como un type predicate
 * (`asserts user is { role: 'admin_segurasist' }`) para que el typing post-
 * llamada quede afinado.
 */
import { ForbiddenException } from '@nestjs/common';

/**
 * Shape mínimo del actor — coincide con `AuthUser` de
 * `@common/decorators/current-user.decorator` pero deliberadamente laxo
 * para no introducir un import circular con un tipo más estricto.
 */
export interface PlatformAdminCandidate {
  role?: string | null;
  /** Compat con guards previos que setean platformAdmin=true en el JWT validation. */
  platformAdmin?: boolean;
}

/**
 * Lanza `ForbiddenException` si `user` no es platform admin.
 *
 * Acepta dos representaciones del rol superadmin en el codebase:
 *   1. `role === 'admin_segurasist'`   — JWT attribute `custom:role`
 *   2. `platformAdmin === true`        — flag derivado por el JwtAuthGuard
 *
 * El check es OR-inclusive porque ambos conviven en la base de código actual.
 * Cuando se unifique (ADR-0001 follow-up), simplificar a una sola
 * representación.
 *
 * Use case típico:
 * ```typescript
 * @Get('cross-tenant-thing')
 * @Roles('admin_segurasist')
 * async listAll(@CurrentUser() user: AuthUser) {
 *   assertPlatformAdmin(user); // defense-in-depth runtime
 *   return this.bypass.client.thing.findMany();
 * }
 * ```
 */
export function assertPlatformAdmin(
  user: PlatformAdminCandidate | undefined | null,
): asserts user is PlatformAdminCandidate & { role: 'admin_segurasist' } {
  if (!user) {
    throw new ForbiddenException('platform_admin role required');
  }
  if (user.platformAdmin === true) {
    return;
  }
  if (user.role === 'admin_segurasist') {
    return;
  }
  throw new ForbiddenException('platform_admin role required');
}
