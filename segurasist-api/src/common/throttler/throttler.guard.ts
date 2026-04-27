import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthUser } from '../decorators/current-user.decorator';
import type { TenantCtx } from '../decorators/tenant.decorator';
import { buildProblem } from '../error-codes';
import { buildTenantKey } from './throttler-redis.storage';
import { SKIP_THROTTLE_KEY, TENANT_THROTTLE_KEY, THROTTLE_KEY } from './throttler.decorators';
import { ThrottleConfig, ThrottlerStorage } from './throttler.types';

export const THROTTLER_STORAGE_TOKEN = 'THROTTLER_STORAGE';
export const THROTTLER_DEFAULT_TOKEN = 'THROTTLER_DEFAULT';
export const THROTTLER_TENANT_DEFAULT_TOKEN = 'THROTTLER_TENANT_DEFAULT';

/**
 * Guard global de rate limiting.
 *
 * Estrategia de key (S3-10 — defensa en doble capa):
 *
 * 1. Bucket "user-IP" (Sprint 1):
 *    - Con sesión: `u:<userId>:<ip>` — evita que un NAT corporativo (típico
 *      en hospitales) tire el cupo compartido y rate-limitee a TODOS los
 *      operadores legítimos.
 *    - Sin user (público / pre-auth): `ip:<ip>`.
 *
 * 2. Bucket "tenant-level" (Sprint 3 S3-10):
 *    - Sólo si `req.tenant` está presente (poblado por JwtAuthGuard).
 *    - Key `t:<tenantId>` agnóstica de IP — captura ataques distribuidos
 *      donde un mismo tenant satura un endpoint desde IPs distintas (call
 *      center con NAT-pool, VPN rotativa, scraping).
 *    - Default permisivo (1000 req/min/tenant) para no afectar legítimos;
 *      override estricto en endpoints sensibles vía `@TenantThrottle`
 *      (`/v1/batches` 100/min, `/v1/insureds/export` 10/min, etc.).
 *
 * Aplica el MÁS RESTRICTIVO: si CUALQUIERA de los dos buckets se excede,
 * levantamos 429. Importante: ambos `INCR`s ocurren incluso si el primero
 * decide bloquear, para que el cierre de la ventana sea coherente entre
 * réplicas (no falsea contadores entre nodos).
 *
 * Por eso este guard se registra DESPUÉS de `JwtAuthGuard` en `APP_GUARD`.
 *
 * Cuando la key se bloquea: levantamos un `HttpException` con status 429.
 * El `HttpExceptionFilter` global convierte eso a un Problem Details
 * `RATE_LIMITED` (RFC 7807). Adicionalmente seteamos los headers estándar:
 *   - `Retry-After`: segundos hasta el reinicio de la ventana.
 *   - `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
 *   - `X-RateLimit-Scope`: `user` o `tenant` cuando bloquea, para debug.
 *
 * Los headers reflejan SIEMPRE el bucket más restrictivo (menor remaining)
 * para que el cliente vea el techo real al que está chocando.
 */
@Injectable()
export class ThrottlerGuard implements CanActivate {
  private readonly log = new Logger(ThrottlerGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(THROTTLER_STORAGE_TOKEN) private readonly storage: ThrottlerStorage,
    @Inject(THROTTLER_DEFAULT_TOKEN) private readonly defaultConfig: ThrottleConfig,
    @Inject(THROTTLER_TENANT_DEFAULT_TOKEN) private readonly tenantDefaultConfig: ThrottleConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    // Kill switch operativo. `THROTTLE_ENABLED=false` (o `0`) deshabilita el
    // guard completo. Util durante incidentes (Redis caído + WAF perimetral
    // tomando el relevo) y para suites e2e que comparten estado y harían
    // 429 entre sí. El integration spec de throttler NO mira esta var
    // porque usa un módulo aislado de test.
    const enabledRaw = process.env.THROTTLE_ENABLED;
    if (enabledRaw === 'false' || enabledRaw === '0') return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_THROTTLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const override = this.reflector.getAllAndOverride<ThrottleConfig | undefined>(THROTTLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const config = override ?? this.defaultConfig;

    const tenantOverride = this.reflector.getAllAndOverride<ThrottleConfig | undefined>(TENANT_THROTTLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const tenantConfig = tenantOverride ?? this.tenantDefaultConfig;

    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest<FastifyRequest & { user?: AuthUser; tenant?: TenantCtx }>();
    const res = httpCtx.getResponse<FastifyReply>();

    const ip = this.extractIp(req);
    const userId = req.user?.id;
    const tenantId = req.tenant?.id;
    // userId+IP cuando hay sesión, IP solo cuando es preauth o público.
    // Incluimos también method+route para que p.ej. login y otp/request
    // tengan cubetas independientes (si no, un usuario podría agotar OTP
    // simplemente enviando logins).
    const route = this.extractRouteIdentifier(req);
    const subject = userId ? `u:${userId}:${ip}` : `ip:${ip}`;
    const userKey = `${route}|${subject}`;

    // Bucket #1 — user-IP (siempre se evalúa).
    const userResult = await this.storage.increment(userKey, config.ttl);
    const userRemaining = Math.max(0, config.limit - userResult.totalHits);
    const userResetSeconds = Math.max(1, Math.ceil(userResult.timeToExpireMs / 1000));
    const userExceeded = userResult.totalHits > config.limit;

    // Bucket #2 — tenant-level (sólo si `req.tenant` está presente).
    // Las rutas públicas (login, otp/request pre-auth) y el superadmin
    // cross-tenant NO tienen `req.tenant`, así que sólo aplica el bucket
    // user-IP. `@TenantThrottle` en `/v1/auth/otp/request` no se activa por
    // este motivo — para esa ruta el cupo per-IP de 5/min ya cubre.
    let tenantExceeded = false;
    let tenantRemaining = Number.POSITIVE_INFINITY;
    let tenantResetSeconds = userResetSeconds;
    let effectiveTenantLimit = config.limit;
    if (tenantId) {
      const tenantKey = buildTenantKey(tenantId, route);
      const tenantResult = await this.storage.increment(tenantKey, tenantConfig.ttl);
      tenantRemaining = Math.max(0, tenantConfig.limit - tenantResult.totalHits);
      tenantResetSeconds = Math.max(1, Math.ceil(tenantResult.timeToExpireMs / 1000));
      tenantExceeded = tenantResult.totalHits > tenantConfig.limit;
      effectiveTenantLimit = tenantConfig.limit;
    }

    // Headers reflejan el bucket más restrictivo (menor remaining) para que
    // el cliente vea el verdadero techo al que está chocando. Si tenant es
    // más restrictivo, exponemos su limit/remaining; si no, los del user.
    const tenantIsTighter = tenantId !== undefined && tenantRemaining < userRemaining;
    const reportedLimit = tenantIsTighter ? effectiveTenantLimit : config.limit;
    const reportedRemaining = tenantIsTighter ? tenantRemaining : userRemaining;
    const reportedReset = tenantIsTighter ? tenantResetSeconds : userResetSeconds;

    void res.header('X-RateLimit-Limit', String(reportedLimit));
    void res.header('X-RateLimit-Remaining', String(reportedRemaining));
    void res.header('X-RateLimit-Reset', String(reportedReset));

    if (userExceeded || tenantExceeded) {
      // Si ambos exceden, el "scope" reportado es el más restrictivo
      // (= el que primero se llenó); usamos remaining=0 como tie-breaker
      // hacia tenant porque típicamente es el ataque coordinado.
      const blockedByTenant = tenantExceeded && (!userExceeded || tenantRemaining <= userRemaining);
      const scope = blockedByTenant ? 'tenant' : 'user';
      const retryAfter = blockedByTenant ? tenantResetSeconds : userResetSeconds;
      void res.header('Retry-After', String(retryAfter));
      void res.header('X-RateLimit-Scope', scope);
      this.log.warn(
        {
          scope,
          userKey,
          tenantId,
          userHits: userResult.totalHits,
          userLimit: config.limit,
          tenantLimit: tenantId ? effectiveTenantLimit : null,
          route,
        },
        'rate limit exceeded',
      );
      // Levantamos HttpException(429). El HttpExceptionFilter mapea a
      // Problem Details `RATE_LIMITED`. Pasamos un mensaje humano para el
      // `detail` del problem (no "E-429"). El `scope` viaja en header para
      // que el frontend pueda diferenciar mensaje (ej. "el tenant está
      // saturando este endpoint" vs. "tu cuenta está enviando demasiadas").
      throw new HttpException(
        {
          message: 'Demasiadas solicitudes. Intenta de nuevo en unos segundos.',
          retryAfterSeconds: retryAfter,
          scope,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private extractIp(req: FastifyRequest): string {
    // Fastify con `trustProxy: true` ya resuelve `req.ip` a partir de
    // X-Forwarded-For. Fallback a 'unknown' para evitar undefined en la key.
    return (req.ip || req.socket?.remoteAddress || 'unknown').toString();
  }

  private extractRouteIdentifier(req: FastifyRequest): string {
    // Preferimos `routeOptions.url` (template `/v1/insureds/:id`) si está
    // disponible para que distintos `/:id` compartan cuota. Fallback al
    // método+url crudo. Nota: en algunos handlers tempranos (pre-router)
    // no hay routeOptions; método solo es suficiente como fallback.
    const method = req.method;
    const route =
      (req as unknown as { routeOptions?: { url?: string } }).routeOptions?.url ??
      (req as unknown as { routerPath?: string }).routerPath ??
      req.url ??
      '*';
    return `${method}:${route}`;
  }
}

// Re-export para que el HttpExceptionFilter pueda construir un problem si lo
// importan desde aquí, manteniendo el catalogue unificado.
export { buildProblem };
