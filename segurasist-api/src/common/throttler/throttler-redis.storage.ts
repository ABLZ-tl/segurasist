import { RedisService } from '@infra/cache/redis.service';
import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage } from './throttler.types';

/**
 * S3-10 — Helper estable para construir la key del bucket "tenant-level".
 *
 * Por qué un helper en vez de inline en el guard: la auditoría Sprint 1 H1
 * detectó que un mismo tenant podía saturar `/v1/batches` con miles de
 * requests *desde IPs distintas* (call center con NAT-pool / VPN rotativa).
 * El bucket user+IP no agarra ese ataque porque cada request "se ve" como un
 * cliente distinto. La defensa es un segundo bucket cuya key sólo depende de
 * `(tenantId, route)` — agnóstico de IP/usuario — para imponer un techo
 * agregado por tenant.
 *
 * Usamos prefix `t:` para que sea trivialmente diferenciable en `MONITOR` /
 * `redis-cli KEYS` de las keys user-IP (`u:` / `ip:`). El TTL/limit lo
 * resuelve el guard porque puede sobrescribirse vía `@TenantThrottle`.
 */
export function buildTenantKey(tenantId: string, route: string): string {
  return `${route}|t:${tenantId}`;
}

/**
 * Storage Redis del rate limiter.
 *
 * Usa `INCR` + `PEXPIRE` para mantener un contador por (key + ventana).
 * - Primer hit en la ventana inicializa el contador y le pone TTL.
 * - Siguientes hits sólo incrementan; el TTL se conserva.
 *
 * Ventana fija (no sliding): `windowStart = floor(now / ttl) * ttl`. La key
 * incluye `windowStart` para que dos ventanas consecutivas no se mezclen y
 * para evitar tener que resetear contadores manualmente. Esta variante es
 * marginalmente más permisiva en los bordes que un sliding-window puro pero
 * suficiente para los objetivos del MVP (anti-bruteforce login + cuota
 * operativa) y NO requiere Lua.
 *
 * Si Redis falla, hacemos *fail-open* (no bloqueamos): preferimos servir
 * tráfico legítimo a un cliente con un Redis caído antes que desplomar el
 * API. WAF perimetral (CloudFront + AWS WAF) cubre el peor caso.
 */
@Injectable()
export class ThrottlerRedisStorage implements ThrottlerStorage {
  private readonly log = new Logger(ThrottlerRedisStorage.name);

  constructor(private readonly redis: RedisService) {}

  async increment(key: string, ttlMs: number): Promise<{ totalHits: number; timeToExpireMs: number }> {
    const now = Date.now();
    const windowStart = Math.floor(now / ttlMs) * ttlMs;
    const redisKey = `throttle:${key}:${windowStart}`;

    try {
      const client = this.redis.raw;
      // Pipeline para minimizar round-trips: INCR + PEXPIRE.
      // PEXPIRE sólo aplica si la key acaba de crearse (el TTL ya existe en
      // hits subsecuentes y no queremos resetearlo en cada llamada). Para
      // evitar la condición "key sin TTL" si el segundo PEXPIRE perdiera
      // ejecución, lo aplicamos siempre la primera vez detectada.
      const pipeline = client.multi();
      pipeline.incr(redisKey);
      pipeline.pttl(redisKey);
      const results = await pipeline.exec();
      if (!results) {
        return { totalHits: 0, timeToExpireMs: ttlMs };
      }
      const incrResult = results[0]?.[1];
      const pttlResult = results[1]?.[1];
      const totalHits = typeof incrResult === 'number' ? incrResult : Number(incrResult ?? 0);
      let timeToExpireMs = typeof pttlResult === 'number' ? pttlResult : Number(pttlResult ?? -1);

      // Primer hit (totalHits === 1) o key sin TTL (-1) → fijamos expiración.
      if (totalHits === 1 || timeToExpireMs < 0) {
        await client.pexpire(redisKey, ttlMs);
        timeToExpireMs = ttlMs;
      }

      return { totalHits, timeToExpireMs };
    } catch (err) {
      // Fail-open. WAF perimetral protege en caso de caída de Redis.
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err), key: redisKey },
        'rate-limit storage error; failing open',
      );
      return { totalHits: 0, timeToExpireMs: ttlMs };
    }
  }
}
