/**
 * H-18 (Sprint 4) — Integration test del `ExportRateLimitGuard` (10/día/tenant).
 *
 * Contexto:
 *   El guard cuenta exports por tenant en una ventana de 24h vía
 *   `PrismaBypassRlsService.export.count(...)`. La protección es la segunda
 *   capa anti-abuse PII (la primera es `@Throttle({limit:1,ttl:60_000})`
 *   por user). Antes de Sprint 4 no había NINGÚN test del guard — los edge
 *   cases (sin tenant, kill switch, fail-open dev, jobs failed que NO
 *   cuentan, ventana 24h sliding) quedaban no cubiertos.
 *
 * Estrategia:
 *   - Mockeamos `PrismaBypassRlsService` con `mockDeep` para controlar el
 *     `count()` de la tabla `exports`.
 *   - Mockeamos `ExecutionContext` con un `req.tenant.id` y `getType=http`.
 *   - Verificamos los 6 caminos del guard:
 *
 *      1. context !== 'http' → bypass (true).
 *      2. THROTTLE_ENABLED='false' → bypass.
 *      3. Sin `req.tenant.id` → bypass (superadmin global).
 *      4. `bypass.isEnabled()=false` → fail-open con warning (dev).
 *      5. count < cap → permite + count se hace contra `requestedAt >= since`.
 *      6. count >= cap → throws HttpException 429 con cuerpo localizado.
 *
 * Plus: verificamos que el COUNT excluye `status='failed'` (los jobs fallidos
 * no deben gastar cuota).
 */
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { PrismaBypassRlsService } from '../../src/common/prisma/prisma-bypass-rls.service';
import {
  EXPORT_DAILY_CAP_PER_TENANT,
  EXPORT_WINDOW_MS,
  ExportRateLimitGuard,
} from '../../src/modules/insureds/export-rate-limit.guard';

Logger.overrideLogger(false);

const TENANT_A = '11111111-1111-1111-1111-111111111111';

interface FakeReq {
  tenant?: { id: string };
}

function makeContext(req: FakeReq, type: 'http' | 'rpc' = 'http'): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => () => undefined,
    }),
    // Métodos no usados — devolvemos no-ops para satisfacer la interface.
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getArgs: () => [],
    getArgByIndex: () => undefined,
    getClass: () => undefined as never,
    getHandler: () => undefined as never,
  } as unknown as ExecutionContext;
}

describe('ExportRateLimitGuard (H-18)', () => {
  let bypass: DeepMockProxy<PrismaBypassRlsService>;
  let guard: ExportRateLimitGuard;
  const ORIGINAL_THROTTLE_ENABLED = process.env.THROTTLE_ENABLED;

  beforeEach(() => {
    bypass = mockDeep<PrismaBypassRlsService>();
    bypass.isEnabled.mockReturnValue(true);
    guard = new ExportRateLimitGuard(bypass);
    // Aseguramos kill switch OFF por defecto (sino el primer test bypassa todo).
    delete process.env.THROTTLE_ENABLED;
  });

  afterAll(() => {
    if (ORIGINAL_THROTTLE_ENABLED === undefined) delete process.env.THROTTLE_ENABLED;
    else process.env.THROTTLE_ENABLED = ORIGINAL_THROTTLE_ENABLED;
  });

  it('context.getType() !== "http" → bypass (RPC/WS)', async () => {
    const ctx = makeContext({ tenant: { id: TENANT_A } }, 'rpc');
    const ok = await guard.canActivate(ctx);
    expect(ok).toBe(true);
    expect(bypass.client.export.count).not.toHaveBeenCalled();
  });

  it('THROTTLE_ENABLED=false → bypass (kill switch dev)', async () => {
    process.env.THROTTLE_ENABLED = 'false';
    const ctx = makeContext({ tenant: { id: TENANT_A } });
    const ok = await guard.canActivate(ctx);
    expect(ok).toBe(true);
    expect(bypass.client.export.count).not.toHaveBeenCalled();
  });

  it('THROTTLE_ENABLED=0 → bypass (alias de "false")', async () => {
    process.env.THROTTLE_ENABLED = '0';
    const ctx = makeContext({ tenant: { id: TENANT_A } });
    const ok = await guard.canActivate(ctx);
    expect(ok).toBe(true);
  });

  it('sin req.tenant.id (superadmin global) → bypass', async () => {
    const ctx = makeContext({});
    const ok = await guard.canActivate(ctx);
    expect(ok).toBe(true);
    expect(bypass.client.export.count).not.toHaveBeenCalled();
  });

  it('bypass.isEnabled()=false (dev sin DATABASE_URL_BYPASS) → fail-open', async () => {
    bypass.isEnabled.mockReturnValue(false);
    const ctx = makeContext({ tenant: { id: TENANT_A } });
    const ok = await guard.canActivate(ctx);
    expect(ok).toBe(true);
    expect(bypass.client.export.count).not.toHaveBeenCalled();
  });

  it('count < cap → permite y query es contra ventana 24h con status pending|processing|ready', async () => {
    bypass.client.export.count.mockResolvedValue(EXPORT_DAILY_CAP_PER_TENANT - 1);
    const ctx = makeContext({ tenant: { id: TENANT_A } });
    const before = Date.now();
    const ok = await guard.canActivate(ctx);
    const after = Date.now();

    expect(ok).toBe(true);
    expect(bypass.client.export.count).toHaveBeenCalledTimes(1);
    const callArgs = bypass.client.export.count.mock.calls[0]?.[0] as
      | {
          where: {
            tenantId: string;
            requestedAt: { gte: Date };
            status: { in: string[] };
          };
        }
      | undefined;
    expect(callArgs?.where.tenantId).toBe(TENANT_A);
    // requestedAt >= now - 24h, con tolerancia para el roundtrip del test.
    const sinceMs = callArgs?.where.requestedAt.gte.getTime() ?? 0;
    expect(sinceMs).toBeGreaterThanOrEqual(before - EXPORT_WINDOW_MS - 50);
    expect(sinceMs).toBeLessThanOrEqual(after - EXPORT_WINDOW_MS + 50);
    // status filter: pending + processing + ready (NO failed).
    expect(callArgs?.where.status.in).toEqual(['pending', 'processing', 'ready']);
    expect(callArgs?.where.status.in).not.toContain('failed');
  });

  it('count === cap → throws HttpException 429 con retryAfterSeconds=3600', async () => {
    bypass.client.export.count.mockResolvedValue(EXPORT_DAILY_CAP_PER_TENANT);
    const ctx = makeContext({ tenant: { id: TENANT_A } });
    let thrown: HttpException | undefined;
    try {
      await guard.canActivate(ctx);
    } catch (err) {
      thrown = err as HttpException;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect(thrown?.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    const body = thrown?.getResponse() as { message: string; retryAfterSeconds: number };
    expect(body.message).toMatch(/límite de 10 exportaciones/i);
    expect(body.retryAfterSeconds).toBe(3600);
  });

  it('count >= cap+1 (atacante intentando un 11º request) → throws 429', async () => {
    bypass.client.export.count.mockResolvedValue(EXPORT_DAILY_CAP_PER_TENANT + 5);
    const ctx = makeContext({ tenant: { id: TENANT_A } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });

  it('escenario E2E: 11 invocaciones consecutivas → request #11 falla (cap=10)', async () => {
    // Modelamos el contador real: cada request exitoso incrementa el count
    // que el guard ve en el siguiente request (porque persiste en BD).
    let storedCount = 0;
    bypass.client.export.count.mockImplementation((async () => storedCount) as never);

    const results: Array<'ok' | 'blocked'> = [];
    for (let i = 0; i < 11; i += 1) {
      const ctx = makeContext({ tenant: { id: TENANT_A } });
      try {
        const ok = await guard.canActivate(ctx);
        if (ok) {
          results.push('ok');
          storedCount += 1;
        }
      } catch (err) {
        if (err instanceof HttpException && err.getStatus() === 429) {
          results.push('blocked');
        } else {
          throw err;
        }
      }
    }

    expect(results).toHaveLength(11);
    expect(results.slice(0, 10)).toEqual(Array(10).fill('ok'));
    expect(results[10]).toBe('blocked');
  });

  it('cap diario aislado por tenant: tenant B con cuenta limpia no se ve afectado por tenant A saturado', async () => {
    bypass.client.export.count.mockImplementation((async (args: unknown) => {
      const a = args as { where: { tenantId: string } };
      return a.where.tenantId === TENANT_A ? 10 : 0;
    }) as never);

    const ctxA = makeContext({ tenant: { id: TENANT_A } });
    await expect(guard.canActivate(ctxA)).rejects.toBeInstanceOf(HttpException);

    const TENANT_B = '22222222-2222-2222-2222-222222222222';
    const ctxB = makeContext({ tenant: { id: TENANT_B } });
    await expect(guard.canActivate(ctxB)).resolves.toBe(true);
  });

  it('exporta el cap como constante para que los tests downstream no hardcoden 10', () => {
    expect(EXPORT_DAILY_CAP_PER_TENANT).toBe(10);
    expect(EXPORT_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});
