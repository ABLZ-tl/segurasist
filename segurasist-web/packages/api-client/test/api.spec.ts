/**
 * Sprint 5 — CC-03 (MT-2 iter 2).
 *
 * Tests del helper `apiMultipart()` exportado desde `../src/client`.
 *
 * Cubre el contrato que documenta la función:
 *   - Path ruteado por `/api/proxy/<path>` (mismo wrapper que `api()`).
 *   - Header `x-trace-id` siempre presente, formato UUID v4.
 *   - **NO** inyecta `content-type: application/json` — deja que el browser
 *     calcule el boundary del multipart. Verificamos tanto con headers
 *     explícitos como dentro del init pasado a `fetch`.
 *   - `body` propagado tal cual es la `FormData` original (instanceof check).
 *   - Verbo default `POST`, override a `PUT` con opts.method.
 *   - Soporte de `signal` para abort (React Query / unmount).
 *   - Tenant override S3-08 también funciona acá.
 *   - non-2xx → throws `ProblemDetailsError` con `.status`/`.problem`.
 *   - 204 → undefined.
 *
 * Por qué no usamos `helpers.ts`: el `setupFetchMock` del helper convierte
 * `init.body` a string sólo si lo es; perderíamos la `FormData`. Acá usamos
 * un mock más simple que captura el RequestInit completo.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  apiMultipart,
  registerTenantOverrideGetter,
} from '../src/client';
import { ProblemDetailsError } from '../src/problem-details';

interface CapturedCall {
  url: string;
  init: RequestInit;
}

const ORIGINAL_FETCH = globalThis.fetch;

function installFetch(
  responder: (call: CapturedCall) => Response | Promise<Response>,
): { calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const call: CapturedCall = { url, init: init ?? {} };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return { calls };
}

function jsonResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function problemResponse(status: number, detail = 'error'): Response {
  return new Response(
    JSON.stringify({
      type: 'about:blank',
      title: `HTTP ${status}`,
      status,
      detail,
      traceId: 'test-trace',
    }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  registerTenantOverrideGetter(null);
});

describe('apiMultipart() — CC-03 (MT-2 iter 2)', () => {
  it('rutea por /api/proxy/<path> y envía x-trace-id (UUID v4)', async () => {
    const { calls } = installFetch(() => jsonResponse({ ok: true }));
    const fd = new FormData();
    fd.append('file', new Blob(['x'], { type: 'image/png' }), 'logo.png');
    await apiMultipart<{ ok: boolean }>('/v1/admin/tenants/t1/branding/logo', fd);
    expect(calls[0]?.url).toBe('/api/proxy/v1/admin/tenants/t1/branding/logo');
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers['x-trace-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('NO inyecta content-type — el browser pone el boundary del multipart', async () => {
    const { calls } = installFetch(() => jsonResponse({ ok: true }));
    const fd = new FormData();
    fd.append('file', new Blob(['x']), 'a.bin');
    await apiMultipart('/v1/x', fd);

    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    // Acepta variaciones de casing por defensiva.
    const lowered = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    expect(lowered['content-type']).toBeUndefined();
  });

  it('body es la misma instancia de FormData que recibió', async () => {
    const { calls } = installFetch(() => jsonResponse({ ok: true }));
    const fd = new FormData();
    fd.append('file', new Blob(['x']), 'a.bin');
    fd.append('meta', 'value');
    await apiMultipart('/v1/x', fd);
    const body = calls[0]?.init.body;
    expect(body).toBeInstanceOf(FormData);
    expect(body).toBe(fd);
    // Y los campos llegan intactos:
    expect((body as FormData).get('meta')).toBe('value');
  });

  it('verbo default POST; override a PUT con opts.method', async () => {
    const { calls } = installFetch(() => jsonResponse({ ok: true }));
    const fd = new FormData();
    fd.append('a', '1');
    await apiMultipart('/v1/post', fd);
    await apiMultipart('/v1/put', fd, { method: 'PUT' });
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[1]?.init.method).toBe('PUT');
  });

  it('propaga AbortSignal a fetch', async () => {
    const { calls } = installFetch(() => jsonResponse({ ok: true }));
    const fd = new FormData();
    const ctrl = new AbortController();
    await apiMultipart('/v1/x', fd, { signal: ctrl.signal });
    expect(calls[0]?.init.signal).toBe(ctrl.signal);
  });

  it('inyecta x-tenant-override cuando hay getter registrado (S3-08)', async () => {
    const { calls } = installFetch(() => jsonResponse({ ok: true }));
    registerTenantOverrideGetter(() => 'tenant-mac-uuid');
    const fd = new FormData();
    fd.append('a', '1');
    await apiMultipart('/v1/x', fd);
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers['x-tenant-override']).toBe('tenant-mac-uuid');
  });

  it('non-2xx → throws ProblemDetailsError con status preservado', async () => {
    installFetch(() => problemResponse(413, 'file too large'));
    const fd = new FormData();
    fd.append('a', '1');
    await expect(apiMultipart('/v1/x', fd)).rejects.toBeInstanceOf(
      ProblemDetailsError,
    );
    await expect(apiMultipart('/v1/x', fd)).rejects.toMatchObject({
      status: 413,
    });
  });

  it('204 → resuelve undefined sin .json()', async () => {
    installFetch(() => new Response(null, { status: 204 }));
    const fd = new FormData();
    fd.append('a', '1');
    const r = await apiMultipart<void>('/v1/x', fd);
    expect(r).toBeUndefined();
  });

  it('respeta headers extra del caller pero sigue sin content-type por default', async () => {
    const { calls } = installFetch(() => jsonResponse({ ok: true }));
    const fd = new FormData();
    fd.append('a', '1');
    await apiMultipart('/v1/x', fd, { headers: { 'x-extra': 'yes' } });
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers['x-extra']).toBe('yes');
    const lowered = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    expect(lowered['content-type']).toBeUndefined();
  });
});

describe('apiMultipart() — integración con useUploadLogoMutation', () => {
  it('el hook MT-2 termina llamando apiMultipart con el path y FormData esperados', async () => {
    // Spy en la fetch global; el hook crea su propio FormData internamente.
    const { calls } = installFetch(() => jsonResponse({ logoUrl: 'cdn://x' }));

    // Importamos el hook localmente para evitar interferencia con otros tests
    // del archivo (lazy import — necesita window/jsdom ya disponible).
    const { useUploadLogoMutation } = await import(
      '../src/hooks/admin-tenants'
    );
    const { renderHook, waitFor } = await import('@testing-library/react');
    const { makeWrapper } = await import('./helpers');
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUploadLogoMutation('tenant-1'), {
      wrapper: Wrapper,
    });
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    await result.current.mutateAsync(file);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(calls[0]?.url).toBe(
      '/api/proxy/v1/admin/tenants/tenant-1/branding/logo',
    );
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBeInstanceOf(FormData);
    const fd = calls[0]?.init.body as FormData;
    const sent = fd.get('file');
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe('logo.png');
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    const lowered = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    expect(lowered['content-type']).toBeUndefined();
  });
});

// Marker para silenciar lint de "vi sin uso" si el archivo crece.
void vi;
