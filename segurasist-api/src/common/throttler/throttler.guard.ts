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
import { buildProblem } from '../error-codes';
import { SKIP_THROTTLE_KEY, THROTTLE_KEY } from './throttler.decorators';
import { ThrottleConfig, ThrottlerStorage } from './throttler.types';

export const THROTTLER_STORAGE_TOKEN = 'THROTTLER_STORAGE';
export const THROTTLER_DEFAULT_TOKEN = 'THROTTLER_DEFAULT';

/**
 * Guard global de rate limiting.
 *
 * Estrategia de key:
 *   - Si el JwtAuthGuard ya populó `req.user.id`, usamos `userId+ip`. Esto
 *     evita que un solo NAT corporativo (típico en hospitales) tire el cupo
 *     compartido de 60 req/min y rate-limitee a TODOS los operadores.
 *   - Sin user (endpoints públicos / login fallido / pre-auth) caemos a IP.
 *
 * Por eso este guard se registra DESPUÉS de `JwtAuthGuard` en `APP_GUARD`.
 *
 * Cuando la key se bloquea: levantamos un `HttpException` con status 429.
 * El `HttpExceptionFilter` global convierte eso a un Problem Details
 * `RATE_LIMITED` (RFC 7807). Adicionalmente seteamos los headers estándar:
 *   - `Retry-After`: segundos hasta el reinicio de la ventana.
 *   - `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
 */
@Injectable()
export class ThrottlerGuard implements CanActivate {
  private readonly log = new Logger(ThrottlerGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(THROTTLER_STORAGE_TOKEN) private readonly storage: ThrottlerStorage,
    @Inject(THROTTLER_DEFAULT_TOKEN) private readonly defaultConfig: ThrottleConfig,
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

    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest<FastifyRequest & { user?: AuthUser }>();
    const res = httpCtx.getResponse<FastifyReply>();

    const ip = this.extractIp(req);
    const userId = req.user?.id;
    // userId+IP cuando hay sesión, IP solo cuando es preauth o público.
    // Incluimos también method+route para que p.ej. login y otp/request
    // tengan cubetas independientes (si no, un usuario podría agotar OTP
    // simplemente enviando logins).
    const route = this.extractRouteIdentifier(req);
    const subject = userId ? `u:${userId}:${ip}` : `ip:${ip}`;
    const key = `${route}|${subject}`;

    const { totalHits, timeToExpireMs } = await this.storage.increment(key, config.ttl);
    const remaining = Math.max(0, config.limit - totalHits);
    const resetSeconds = Math.max(1, Math.ceil(timeToExpireMs / 1000));

    void res.header('X-RateLimit-Limit', String(config.limit));
    void res.header('X-RateLimit-Remaining', String(remaining));
    void res.header('X-RateLimit-Reset', String(resetSeconds));

    if (totalHits > config.limit) {
      void res.header('Retry-After', String(resetSeconds));
      this.log.warn({ key, totalHits, limit: config.limit, route }, 'rate limit exceeded');
      // Levantamos HttpException(429). El HttpExceptionFilter mapea a
      // Problem Details `RATE_LIMITED`. Pasamos un mensaje humano para el
      // `detail` del problem (no "E-429").
      throw new HttpException(
        {
          message: 'Demasiadas solicitudes. Intenta de nuevo en unos segundos.',
          retryAfterSeconds: resetSeconds,
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
