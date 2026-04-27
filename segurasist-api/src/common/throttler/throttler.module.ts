import { DynamicModule, Module } from '@nestjs/common';
import { ThrottlerRedisStorage } from './throttler-redis.storage';
import {
  THROTTLER_DEFAULT_TOKEN,
  THROTTLER_STORAGE_TOKEN,
  THROTTLER_TENANT_DEFAULT_TOKEN,
  ThrottlerGuard,
} from './throttler.guard';
import { ThrottleConfig } from './throttler.types';

/**
 * Default tenant-level cuando ni el caller pasa `tenantDefaultConfig` ni el
 * endpoint lleva `@TenantThrottle`. 1000 req/min/tenant es deliberadamente
 * permisivo para no afectar operativa legítima de un MAC con varios
 * operadores; los endpoints sensibles (`batches`, `export`, `otp`) declaran
 * su propio override mucho más estricto.
 */
const FALLBACK_TENANT_CONFIG: ThrottleConfig = { ttl: 60_000, limit: 1000 };

/**
 * Módulo del rate limiter.
 *
 * `forRoot(defaultConfig)` registra:
 *  - `ThrottlerRedisStorage` como `THROTTLER_STORAGE_TOKEN`.
 *  - El config default user-IP (`{ ttl, limit }`) como `THROTTLER_DEFAULT_TOKEN`.
 *  - El config default tenant-level como `THROTTLER_TENANT_DEFAULT_TOKEN`
 *    (override opcional vía 2do arg; fallback 1000 req/min).
 *  - `ThrottlerGuard` como provider exportable; el `APP_GUARD` lo registra
 *    `app.module.ts` para que corra global y DESPUÉS de JwtAuthGuard.
 *
 * `RedisService` viene de `CacheModule` (que es `@Global()` en este repo).
 */
@Module({})
export class ThrottlerModule {
  static forRoot(defaultConfig: ThrottleConfig, tenantDefaultConfig?: ThrottleConfig): DynamicModule {
    return {
      module: ThrottlerModule,
      providers: [
        { provide: THROTTLER_DEFAULT_TOKEN, useValue: defaultConfig },
        {
          provide: THROTTLER_TENANT_DEFAULT_TOKEN,
          useValue: tenantDefaultConfig ?? FALLBACK_TENANT_CONFIG,
        },
        { provide: THROTTLER_STORAGE_TOKEN, useClass: ThrottlerRedisStorage },
        ThrottlerRedisStorage,
        ThrottlerGuard,
      ],
      exports: [
        ThrottlerGuard,
        THROTTLER_DEFAULT_TOKEN,
        THROTTLER_TENANT_DEFAULT_TOKEN,
        THROTTLER_STORAGE_TOKEN,
      ],
    };
  }
}
