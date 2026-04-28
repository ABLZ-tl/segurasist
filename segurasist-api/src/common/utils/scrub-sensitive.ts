/**
 * Scrubbing recursivo de claves sensibles en objetos arbitrariamente
 * anidados (objetos planos, arrays, mezclas). FUENTE DE VERDAD ÚNICA —
 * H-01 P3 fix: antes había dos listas (esta + `audit.interceptor.ts`)
 * con depth distinto (12 vs 8) → drift garantizado al agregar claves.
 *
 * Consumidores:
 *
 *  - El custom `formatters.log` de pino en `app.module.ts` (M5) — aplica
 *    redact en TODA la profundidad sin depender del wildcard `**` (que
 *    `fast-redact` no soporta).
 *  - El `AuditInterceptor` antes de persistir `payloadDiff` en BD —
 *    importa `SENSITIVE_LOG_KEYS` y `scrubSensitive` desde aquí (NO
 *    redefine).
 *
 * Valor de reemplazo: `[REDACTED]`. Profundidad máxima: 10 niveles
 * (después cortamos para no romper logs por ciclos extremos / DoS de
 * objetos). El valor 10 es el máximo razonable para payloads JSON
 * típicos del dominio (DTOs anidados con metadata) y aún protege contra
 * objetos cíclicos no detectados.
 *
 * No muta el input — hacemos clone defensivo.
 */

const REDACTED = '[REDACTED]';

/**
 * Lista canónica de claves sensibles. ÚNICA fuente para audit interceptor
 * + pino redact + cualquier consumer futuro. Las comparaciones son
 * case-sensitive (la convención del repo es camelCase para claves de log).
 *
 * Cuando agregues una clave nueva, este es el único archivo que tocas.
 */
export const SENSITIVE_LOG_KEYS: ReadonlySet<string> = new Set<string>([
  'password',
  'token',
  'idToken',
  'accessToken',
  'refreshToken',
  'cognitoSub',
  'curp',
  'rfc',
  'authorization',
  'cookie',
  'otp',
  'secret',
  'apiKey',
  'apikey',
]);

/** Alias retrocompatible: el interceptor histórico importaba `SENSITIVE_KEYS`. */
export const SENSITIVE_KEYS = SENSITIVE_LOG_KEYS;

/** Depth máximo único — H-01 P3: antes 12 (este file) + 8 (interceptor). */
export const MAX_SCRUB_DEPTH = 10;

/**
 * Scrub recursivo. `depth=0` es el caller; cada step aumenta hasta
 * `MAX_SCRUB_DEPTH`, donde retornamos `[REDACTED]` (corte defensivo).
 */
export function scrubSensitiveDeep(value: unknown, depth = 0): unknown {
  if (depth > MAX_SCRUB_DEPTH) return REDACTED;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => scrubSensitiveDeep(v, depth + 1));
  }
  if (typeof value === 'object') {
    // Buffers / Date / etc. los dejamos pasar como están (pino los serializa
    // bien). Sólo recursionamos dentro de plain objects.
    const proto: unknown = Object.getPrototypeOf(value);
    const isPlain = proto === Object.prototype || proto === null;
    if (!isPlain) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_LOG_KEYS.has(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = scrubSensitiveDeep(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/**
 * Alias canónico para callers que prefieren un nombre semántico breve.
 * El AuditInterceptor lo usa como `scrubSensitive(body)` en lugar de
 * `scrubSensitiveDeep(body)`. Ambos llaman al mismo helper.
 */
export function scrubSensitive(value: unknown, depth = 0): unknown {
  return scrubSensitiveDeep(value, depth);
}
