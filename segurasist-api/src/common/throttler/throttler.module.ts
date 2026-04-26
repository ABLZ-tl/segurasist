import { DynamicModule, Module } from '@nestjs/common';
import { ThrottlerRedisStorage } from './throttler-redis.storage';
import { THROTTLER_DEFAULT_TOKEN, THROTTLER_STORAGE_TOKEN, ThrottlerGuard } from './throttler.guard';
import { ThrottleConfig } from './throttler.types';

/**
 * Módulo del rate limiter.
 *
 * `forRoot(defaultConfig)` registra:
 *  - `ThrottlerRedisStorage` como `THROTTLER_STORAGE_TOKEN`.
 *  - El config default (`{ ttl, limit }`) como `THROTTLER_DEFAULT_TOKEN`.
 *  - `ThrottlerGuard` como provider exportable; el `APP_GUARD` lo registra
 *    `app.module.ts` para que corra global y DESPUÉS de JwtAuthGuard.
 *
 * `RedisService` viene de `CacheModule` (que es `@Global()` en este repo).
 */
@Module({})
export class ThrottlerModule {
  static forRoot(defaultConfig: ThrottleConfig): DynamicModule {
    return {
      module: ThrottlerModule,
      providers: [
        { provide: THROTTLER_DEFAULT_TOKEN, useValue: defaultConfig },
        { provide: THROTTLER_STORAGE_TOKEN, useClass: ThrottlerRedisStorage },
        ThrottlerRedisStorage,
        ThrottlerGuard,
      ],
      exports: [ThrottlerGuard, THROTTLER_DEFAULT_TOKEN, THROTTLER_STORAGE_TOKEN],
    };
  }
}
