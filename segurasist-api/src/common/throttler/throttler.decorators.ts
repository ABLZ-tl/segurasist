import { SetMetadata } from '@nestjs/common';
import type { ThrottleConfig } from './throttler.types';

export const THROTTLE_KEY = 'throttle:config';
export const TENANT_THROTTLE_KEY = 'throttle:tenant-config';
export const SKIP_THROTTLE_KEY = 'throttle:skip';

/**
 * Override del rate limit por endpoint o controller. Si no se aplica, se usa
 * el default global registrado en `ThrottlerModule.forRoot`.
 *
 * Ejemplo:
 *   @Throttle({ ttl: 60_000, limit: 5 })
 *   @Post('login')
 *   login() { ... }
 */
export const Throttle = (config: ThrottleConfig): MethodDecorator & ClassDecorator =>
  SetMetadata(THROTTLE_KEY, config);

/**
 * S3-10 — Override del rate limit "tenant-level" (bucket agregado por
 * `(tenantId, route)`, agnóstico de IP/usuario).
 *
 * Complementa a `@Throttle`: el guard aplica AMBOS y bloquea con el más
 * restrictivo. Default tenant-level (1000/min) cuando NO está presente este
 * decorador y la request tiene `req.tenant`.
 *
 * Casos donde este decorator es obligatorio:
 *   - `/v1/batches` POST: 100 req/min (ataque: bulk insert masivo).
 *   - `/v1/insureds/export`: 10 req/min (ataque: exfiltración por scraping).
 *   - `/v1/auth/otp/request`: 50 req/min (anti spray cross-CURP).
 *
 * Sin `req.tenant` (rutas públicas / superadmin sin tenant) este decorator
 * es no-op: el bucket tenant no se computa y sólo aplica el user-IP.
 *
 * Ejemplo:
 *   @TenantThrottle({ ttl: 60_000, limit: 100 })
 *   @Post()
 *   upload(...) { ... }
 */
export const TenantThrottle = (config: ThrottleConfig): MethodDecorator & ClassDecorator =>
  SetMetadata(TENANT_THROTTLE_KEY, config);

/**
 * Marca un endpoint o controller como exento del rate limiter (p.ej. health).
 */
export const SkipThrottle = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_THROTTLE_KEY, true);
