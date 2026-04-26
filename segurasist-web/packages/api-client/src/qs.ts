/**
 * Tiny querystring serializer that skips undefined and supports arrays.
 * Generic over the input shape so callers can pass typed DTOs (e.g. ListParams)
 * without losing inference at the call site.
 */
export function qs<T extends object>(params: T): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const v of value) usp.append(key, String(v));
    } else if (value instanceof Date) {
      usp.append(key, value.toISOString());
    } else {
      usp.append(key, String(value));
    }
  }
  return usp.toString();
}
