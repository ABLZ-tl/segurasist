import { ProblemDetailsError } from './problem-details';

/**
 * Fetch wrapper that:
 * - Routes through the in-app `/api/proxy/*` so the access token never touches
 *   the browser (it's added server-side from the HttpOnly cookie).
 * - Generates a per-request `traceId` and forwards it as `x-trace-id`,
 *   propagating into OpenTelemetry on the backend.
 * - Throws a typed `ProblemDetailsError` (RFC 7807) on non-2xx.
 *
 * NEVER call this directly with raw API tokens — that's the proxy's job.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const traceId = crypto.randomUUID();
  const res = await fetch(`/api/proxy${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-trace-id': traceId,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw await ProblemDetailsError.from(res, traceId);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Convenience HTTP verbs */
export const apiGet = <T>(path: string, init?: RequestInit) =>
  api<T>(path, { ...init, method: 'GET' });

export const apiPost = <T, B = unknown>(path: string, body?: B, init?: RequestInit) =>
  api<T>(path, { ...init, method: 'POST', body: body ? JSON.stringify(body) : undefined });

export const apiPut = <T, B = unknown>(path: string, body?: B, init?: RequestInit) =>
  api<T>(path, { ...init, method: 'PUT', body: body ? JSON.stringify(body) : undefined });

export const apiPatch = <T, B = unknown>(path: string, body?: B, init?: RequestInit) =>
  api<T>(path, { ...init, method: 'PATCH', body: body ? JSON.stringify(body) : undefined });

export const apiDelete = <T = void>(path: string, init?: RequestInit) =>
  api<T>(path, { ...init, method: 'DELETE' });
