/**
 * Tiny querystring serializer that skips undefined and supports arrays.
 */
export function qs(params: Record<string, unknown>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
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
