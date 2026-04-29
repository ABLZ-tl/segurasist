import { ProblemDetailsError } from './problem-details';

/**
 * S3-08 — Provider de tenant override. El admin app (Next.js client) registra
 * un getter que lee `useTenantOverride.getState().overrideTenantId`; los
 * portal/insured apps lo dejan unset (no aplica el switcher). El wrapper
 * agrega el header `X-Tenant-Override` solo si el getter devuelve un valor.
 *
 * Por qué no importamos Zustand directamente acá:
 *   - `@segurasist/api-client` se consume desde `apps/admin` Y `apps/portal`.
 *   - El hook `useTenantOverride` vive en `apps/admin/lib/hooks/...` (no
 *     queremos arrastrarlo al portal).
 *   - SSR safety: en Server Components el state Zustand no existe; este
 *     pattern de getter permite que el SSR pase un fallback (o el admin
 *     simplemente no registre el getter en el server-side proxy, que es lo
 *     correcto: los Server Components son del request original, no override).
 */
type TenantOverrideGetter = () => string | null;
let overrideGetter: TenantOverrideGetter | null = null;

export function registerTenantOverrideGetter(getter: TenantOverrideGetter | null): void {
  overrideGetter = getter;
}

/**
 * Fetch wrapper that:
 * - Routes through the in-app `/api/proxy/*` so the access token never touches
 *   the browser (it's added server-side from the HttpOnly cookie).
 * - Generates a per-request `traceId` and forwards it as `x-trace-id`,
 *   propagating into OpenTelemetry on the backend.
 * - S3-08: si hay un override registrado, agrega `X-Tenant-Override`.
 * - Throws a typed `ProblemDetailsError` (RFC 7807) on non-2xx.
 *
 * NEVER call this directly with raw API tokens — that's the proxy's job.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const traceId = crypto.randomUUID();
  const overrideHeaders: Record<string, string> = {};
  // SSR safety: window indica entorno cliente. En SSR/Server Components, NO
  // adjuntamos el header — los Server Components operan con su propio fetch
  // server-to-server y no tienen acceso al store Zustand del cliente.
  if (typeof window !== 'undefined' && overrideGetter) {
    const id = overrideGetter();
    if (id) overrideHeaders['x-tenant-override'] = id;
  }
  const res = await fetch(`/api/proxy${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-trace-id': traceId,
      ...overrideHeaders,
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

/**
 * Sprint 5 — CC-03 (MT-2 iter 2).
 *
 * Multipart helper para `FormData` (uploads). NO podemos usar `api()` /
 * `apiPost()` porque fijan `content-type: application/json`, lo que rompe
 * el boundary que el browser calcula automáticamente para `multipart/form-data`.
 *
 * Mantiene la misma cookie/auth handling que `api()` (rutea por `/api/proxy/*`,
 * inyecta `x-trace-id` y respeta el override de tenant S3-08), y traduce
 * non-2xx a `ProblemDetailsError` igual que el wrapper base.
 *
 * Consumidores iter 2:
 *   - MT-2: `useUploadLogoMutation` (branding logo upload).
 *   - S5-3: import CSV de KB del chatbot (finisher iter 2).
 *
 * Consideraciones:
 *   - `headers` se construyen omitiendo cualquier `content-type`; si el caller
 *     pasa uno explícito en `init.headers` lo respetamos pero **NO** debería
 *     hacerlo: el browser pone el boundary correcto sólo si no hay header.
 *   - `body` siempre es la `FormData` recibida — no la transformamos a string.
 *   - Soporta `signal` para abortar la subida desde el caller (React Query
 *     hace abort automático en unmount cuando se le pasa `signal`).
 */
export interface ApiMultipartOptions {
  method?: 'POST' | 'PUT';
  signal?: AbortSignal;
  /** Headers adicionales — NO incluyas `content-type` (lo decide el browser). */
  headers?: Record<string, string>;
}

export async function apiMultipart<T>(
  path: string,
  formData: FormData,
  opts?: ApiMultipartOptions,
): Promise<T> {
  const traceId = crypto.randomUUID();
  const overrideHeaders: Record<string, string> = {};
  if (typeof window !== 'undefined' && overrideGetter) {
    const id = overrideGetter();
    if (id) overrideHeaders['x-tenant-override'] = id;
  }
  // Headers explícitos: NUNCA seteamos content-type (deja que el browser
  // calcule el boundary del multipart). Si el caller pasa uno, lo respetamos
  // pero el contrato documentado pide NO hacerlo.
  const headers: Record<string, string> = {
    'x-trace-id': traceId,
    ...overrideHeaders,
    ...(opts?.headers ?? {}),
  };
  const res = await fetch(`/api/proxy${path}`, {
    method: opts?.method ?? 'POST',
    body: formData,
    headers,
    signal: opts?.signal,
  });
  if (!res.ok) throw await ProblemDetailsError.from(res, traceId);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
