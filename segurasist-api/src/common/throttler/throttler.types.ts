/**
 * Configuración por endpoint o por defecto del rate limiter.
 *
 * - `ttl`: ventana en milisegundos.
 * - `limit`: número máximo de requests dentro de la ventana.
 *
 * Implementación interna: contador en Redis con TTL = ventana. La key tiene
 * formato `throttle:<key>:<windowStartMs>` para que la expiración natural
 * libere el cupo (sliding-window aproximado por bucket fijo, cumple con la
 * heurística que necesitamos para login bruteforce + abuso de operadores).
 */
export interface ThrottleConfig {
  /** Ventana en milisegundos. */
  ttl: number;
  /** Máximo de requests permitidos en esa ventana. */
  limit: number;
}

export interface ThrottleConsumeResult {
  /** Cuántos requests se han hecho en la ventana actual (incluyendo la actual). */
  totalHits: number;
  /** Tiempo restante en ms para que la ventana se reinicie. */
  timeToExpireMs: number;
  /** True si esta llamada acaba de superar `limit`. */
  isBlocked: boolean;
}

export interface ThrottlerStorage {
  /**
   * Incrementa el contador para `key` dentro de una ventana de `ttlMs`.
   * Devuelve los hits acumulados en esa ventana y cuánto falta para que
   * expire. Implementaciones concretas (Redis, in-memory) deben hacer la
   * operación atómica para evitar races.
   */
  increment(key: string, ttlMs: number): Promise<{ totalHits: number; timeToExpireMs: number }>;
}
