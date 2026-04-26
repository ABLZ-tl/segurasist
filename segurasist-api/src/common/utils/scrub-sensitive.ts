/**
 * Scrubbing recursivo de claves sensibles en objetos arbitrariamente
 * anidados (objetos planos, arrays, mezclas). Usado por:
 *
 *  - El custom `formatters.log` de pino en `app.module.ts` (M5) — aplica
 *    redact en TODA la profundidad sin depender del wildcard `**` (que
 *    `fast-redact` no soporta).
 *  - El `AuditInterceptor` antes de persistir `payloadDiff` en BD.
 *
 * Valor de reemplazo: `[REDACTED]`. Profundidad máxima: 12 niveles (después
 * cortamos para no romper logs por ciclos extremos / DoS de objetos).
 *
 * No muta el input — hacemos clone defensivo.
 */

const REDACTED = '[REDACTED]';

/**
 * Lista canónica de claves sensibles. Mantener sincronizada con la lista
 * del `AuditInterceptor`. Las comparaciones son case-sensitive (la
 * convención del repo es camelCase para claves de log).
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

const MAX_DEPTH = 12;

export function scrubSensitiveDeep(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
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
