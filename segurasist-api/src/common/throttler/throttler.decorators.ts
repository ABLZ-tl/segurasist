import { SetMetadata } from '@nestjs/common';
import type { ThrottleConfig } from './throttler.types';

export const THROTTLE_KEY = 'throttle:config';
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
 * Marca un endpoint o controller como exento del rate limiter (p.ej. health).
 */
export const SkipThrottle = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_THROTTLE_KEY, true);
