/**
 * H-28 — Tests del wrapper `api()` (cliente low-level).
 *
 * Cubre:
 *   - Path siempre ruteado a `/api/proxy/<path>`.
 *   - Header `x-trace-id` siempre presente.
 *   - Tenant override S3-08: si hay getter registrado y window definido,
 *     se inyecta `x-tenant-override`. Si no hay getter, NO se inyecta.
 *   - 204 → resuelve undefined.
 *   - non-2xx → throws ProblemDetailsError con status correcto.
 *   - Verbos de conveniencia (apiGet/apiPost/apiPatch/apiPut/apiDelete).
 */
import { describe, expect, it, afterEach } from 'vitest';
import {
  api,
  apiGet,
  apiPost,
  apiPatch,
  apiPut,
  apiDelete,
  registerTenantOverrideGetter,
} from '../src/client';
import {
  fetchCalls,
  jsonResponse,
  problemResponse,
  restoreFetch,
  setupFetchMock,
} from './helpers';

afterEach(() => {
  restoreFetch();
  registerTenantOverrideGetter(null);
});

describe('client.api wrapper (H-28)', () => {
  it('rutea por /api/proxy y envía x-trace-id', async () => {
    setupFetchMock(() => jsonResponse({ ok: true }));
    const data = await api<{ ok: boolean }>('/v1/healthz');
    expect(data.ok).toBe(true);
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/healthz');
    expect(fetchCalls[0].headers['x-trace-id']).toBeDefined();
    expect(fetchCalls[0].headers['x-trace-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('204 → resuelve undefined sin .json()', async () => {
    setupFetchMock(() => new Response(null, { status: 204 }));
    const r = await api<void>('/v1/something', { method: 'DELETE' });
    expect(r).toBeUndefined();
  });

  it('5xx → throws con status preservado', async () => {
    setupFetchMock(() => problemResponse(500, 'down'));
    await expect(api('/v1/x')).rejects.toMatchObject({ status: 500 });
  });

  it('inyecta x-tenant-override cuando hay getter (S3-08)', async () => {
    setupFetchMock(() => jsonResponse({ ok: true }));
    registerTenantOverrideGetter(() => 'tenant-mac-uuid');
    await api('/v1/insureds');
    expect(fetchCalls[0].headers['x-tenant-override']).toBe('tenant-mac-uuid');
  });

  it('NO inyecta x-tenant-override cuando getter devuelve null', async () => {
    setupFetchMock(() => jsonResponse({ ok: true }));
    registerTenantOverrideGetter(() => null);
    await api('/v1/insureds');
    expect(fetchCalls[0].headers['x-tenant-override']).toBeUndefined();
  });

  it('apiGet/apiPost/apiPatch/apiPut/apiDelete respetan el verbo', async () => {
    setupFetchMock(() => jsonResponse({ ok: true }));
    await apiGet('/v1/a');
    await apiPost('/v1/b', { x: 1 });
    await apiPatch('/v1/c', { x: 2 });
    await apiPut('/v1/d', { x: 3 });
    await apiDelete('/v1/e');
    expect(fetchCalls.map((c) => c.method)).toEqual(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);
    // POST/PATCH/PUT serializan body como JSON.
    expect(JSON.parse(fetchCalls[1].body ?? '{}')).toEqual({ x: 1 });
    expect(JSON.parse(fetchCalls[2].body ?? '{}')).toEqual({ x: 2 });
    expect(JSON.parse(fetchCalls[3].body ?? '{}')).toEqual({ x: 3 });
  });

  it('respeta headers explícitos del caller (no los pisa)', async () => {
    setupFetchMock(() => jsonResponse({ ok: true }));
    await api('/v1/x', { headers: { 'x-custom': 'yes' } });
    expect(fetchCalls[0].headers['x-custom']).toBe('yes');
    expect(fetchCalls[0].headers['x-trace-id']).toBeDefined();
  });
});
