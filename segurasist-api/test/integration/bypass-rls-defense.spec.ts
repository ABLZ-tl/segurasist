/**
 * H-15 (Sprint 4) — Integration test del branch `bypassRls=true` de
 * `PrismaService` (líneas 137-141 de `prisma.service.ts`).
 *
 * Contexto:
 *   El extender Prisma de `PrismaService` tiene tres caminos:
 *     (a) Sin model (raw queries) → pasa directo.
 *     (b) `bypassRls=true` (request lo marcó vía JwtAuthGuard para superadmin):
 *         se LOGEA un warning y se ejecuta `query(args)` SIN setear
 *         `app.current_tenant`. Como el rol DB sigue siendo `segurasist_app`
 *         (NOBYPASSRLS), las RLS policies aplican y la query devuelve 0
 *         filas — defensa en profundidad: si un service superadmin usó
 *         `PrismaService` en lugar de `PrismaBypassRlsService`, no se filtra
 *         data, simplemente se ve vacío.
 *     (c) Tenant scoped: SET LOCAL + re-dispatch.
 *
 * El branch (b) jamás tuvo un integration test que confirmara el contrato
 * "NOBYPASSRLS devuelve 0 filas". Solo unit tests con mocks. Este spec
 * compone el `PrismaService` real contra Postgres real con dos clientes:
 *
 *  1. `bypassRls=true`  → simulando un request superadmin que (por bug)
 *     terminó en `PrismaService` → confirmamos: 0 filas, no exception.
 *  2. `bypassRls=false` + sin tenant context → confirmamos: ForbiddenException
 *     ("Tenant context missing").
 *  3. Sanity check: `PrismaBypassRlsService` (rol DB segurasist_admin) sí ve
 *     la fila — confirmando que NO es un problema de seed sino el contrato
 *     del defense-in-depth de PrismaService.
 *
 * Si Postgres no está disponible o los roles RLS no fueron aplicados, el
 * suite skipea con warn (mismo patrón que `cross-tenant.spec.ts`).
 */
import { randomUUID } from 'node:crypto';
import { ForbiddenException, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/common/prisma/prisma.service';

Logger.overrideLogger(false);

const ADMIN_URL =
  process.env.RLS_TEST_ADMIN_URL ??
  process.env.DATABASE_URL_BYPASS ??
  'postgresql://segurasist_admin:CHANGE_ME_IN_SECRETS_MANAGER@localhost:5432/segurasist?schema=public';
const APP_URL =
  process.env.RLS_TEST_APP_URL ??
  process.env.DATABASE_URL ??
  'postgresql://segurasist_app:CHANGE_ME_IN_SECRETS_MANAGER@localhost:5432/segurasist?schema=public';

async function probe(url: string): Promise<boolean> {
  const c = new PrismaClient({ datasources: { db: { url } }, log: ['error'] });
  try {
    await c.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await c.$disconnect();
  }
}

interface FakeRequest {
  tenant?: { id: string; slug: string; name: string };
  bypassRls?: boolean;
}

/**
 * Construye una instancia real de `PrismaService` con un `req` fake. La
 * conexión interna sigue siendo a `DATABASE_URL` (rol app NOBYPASSRLS).
 */
function buildPrismaService(req: FakeRequest): PrismaService {
  // El constructor lee `req.tenant` y `req.bypassRls` lazy (en cada query).
  // Lo importamos vía `as never` porque el tipo del REQUEST inyectado es
  // request-scoped por NestJS y aquí no tenemos el contenedor.
  process.env.DATABASE_URL = APP_URL;
  return new PrismaService(req as never);
}

describe('PrismaService — bypassRls defense in depth (H-15)', () => {
  let canConnect = false;
  let admin: PrismaClient;
  let tenantA: { id: string };

  beforeAll(async () => {
    canConnect = (await probe(ADMIN_URL)) && (await probe(APP_URL));
    if (!canConnect) {
      // eslint-disable-next-line no-console
      console.warn(
        '[bypass-rls-defense] omitido: postgres + roles RLS no disponibles. ' +
          'Levantá `docker compose up -d postgres` + `apply-rls.sh`.',
      );
      return;
    }
    admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } }, log: ['error'] });
    const slug = `t-bypass-${Date.now()}`;
    tenantA = await admin.tenant.create({
      data: { name: 'Tenant A (bypass-rls test)', slug },
    });
    const pkg = await admin.package.create({
      data: { tenantId: tenantA.id, name: 'pkg-bypass', description: 'pkg' },
    });
    await admin.insured.create({
      data: {
        id: randomUUID(),
        tenantId: tenantA.id,
        curp: 'BYPS800101HDFRRR01',
        fullName: 'Asegurado bypass test',
        dob: new Date('1980-01-01'),
        packageId: pkg.id,
        validFrom: new Date('2026-01-01'),
        validTo: new Date('2027-01-01'),
      },
    });
  }, 30_000);

  afterAll(async () => {
    if (!canConnect || !admin || !tenantA) return;
    await admin.insured.deleteMany({ where: { tenantId: tenantA.id } });
    await admin.package.deleteMany({ where: { tenantId: tenantA.id } });
    await admin.tenant.delete({ where: { id: tenantA.id } });
    await admin.$disconnect();
  }, 30_000);

  it('bypassRls=true + sin tenant context → query devuelve [] (defensa en profundidad), NO throw', async () => {
    if (!canConnect) {
      expect(true).toBe(true);
      return;
    }
    const svc = buildPrismaService({ bypassRls: true });
    await svc.onModuleInit();
    try {
      // El client ejecuta una findMany contra el rol app (NOBYPASSRLS). Como
      // bypassRls=true, NO seteamos `app.current_tenant`; la policy USING
      // filtra y devolvemos 0 filas.
      const rows = await svc.client.insured.findMany({ where: { tenantId: tenantA.id } });
      expect(rows).toEqual([]);
    } finally {
      await svc.onModuleDestroy();
    }
  });

  it('bypassRls=false + sin tenant context → ForbiddenException("Tenant context missing")', async () => {
    if (!canConnect) {
      expect(true).toBe(true);
      return;
    }
    const svc = buildPrismaService({ bypassRls: false });
    await svc.onModuleInit();
    try {
      await expect(svc.client.insured.findMany()).rejects.toThrow(ForbiddenException);
    } finally {
      await svc.onModuleDestroy();
    }
  });

  it('bypassRls=false + tenant context VÁLIDO → query devuelve filas del tenant', async () => {
    if (!canConnect) {
      expect(true).toBe(true);
      return;
    }
    const svc = buildPrismaService({
      bypassRls: false,
      tenant: { id: tenantA.id, slug: 'mac', name: 'Tenant A' },
    });
    await svc.onModuleInit();
    try {
      const rows = await svc.client.insured.findMany();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenantId === tenantA.id)).toBe(true);
    } finally {
      await svc.onModuleDestroy();
    }
  });

  it('bypassRls=false + tenant context con UUID malformado → ForbiddenException("Tenant id malformed")', async () => {
    if (!canConnect) {
      expect(true).toBe(true);
      return;
    }
    const svc = buildPrismaService({
      bypassRls: false,
      tenant: { id: 'not-a-uuid', slug: 'x', name: 'x' },
    });
    await svc.onModuleInit();
    try {
      await expect(svc.client.insured.findMany()).rejects.toThrow(/malformed/i);
    } finally {
      await svc.onModuleDestroy();
    }
  });

  it('sanity: PrismaBypassRlsService (segurasist_admin) sí ve la fila — confirma que el seed existe', async () => {
    if (!canConnect) {
      expect(true).toBe(true);
      return;
    }
    const rows = await admin.insured.findMany({ where: { tenantId: tenantA.id } });
    expect(rows.length).toBeGreaterThan(0);
  });

  it('withTenant() en branch superadmin (bypassRls=true) → throws ForbiddenException (use PrismaBypassRlsService)', async () => {
    if (!canConnect) {
      expect(true).toBe(true);
      return;
    }
    const svc = buildPrismaService({ bypassRls: true });
    await svc.onModuleInit();
    try {
      await expect(
        svc.withTenant(async () => {
          /* never reached */
          return 'x';
        }),
      ).rejects.toThrow(/PrismaBypassRlsService/);
    } finally {
      await svc.onModuleDestroy();
    }
  });
});
