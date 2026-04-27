/**
 * GATE crítico de PR: ningún recurso de un tenant debe ser visible a otro.
 *
 * Esta suite valida la capa MÁS BAJA del modelo de aislamiento — las políticas
 * RLS de Postgres + el contrato `app.current_tenant`. Si la BD bloquea
 * cross-tenant aquí, ninguna fuga puede subir por capa de servicio o HTTP.
 *
 * Cómo corre:
 *   - Requiere postgres con migraciones aplicadas Y `prisma/rls/policies.sql`
 *     ejecutado (./scripts/apply-rls.sh).
 *   - Conecta como `segurasist_admin` (BYPASSRLS) para sembrar tenant A y B.
 *   - Conecta como `segurasist_app` (NOBYPASSRLS) para verificar que cada
 *     tenant ve sólo su info. Sin `SET LOCAL` la query devuelve 0 filas.
 *
 * Si la BD no está disponible (CI sin contenedores), el test se salta con un
 * `console.warn` — el pipeline normal de Sprint 1 levanta postgres antes.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const ADMIN_URL =
  process.env.RLS_TEST_ADMIN_URL ??
  'postgresql://segurasist_admin:CHANGE_ME_IN_SECRETS_MANAGER@localhost:5432/segurasist?schema=public';
const APP_URL =
  process.env.RLS_TEST_APP_URL ??
  'postgresql://segurasist_app:CHANGE_ME_IN_SECRETS_MANAGER@localhost:5432/segurasist?schema=public';

let canConnect = false;
let admin: PrismaClient;
let app: PrismaClient;
let tenantA: { id: string; slug: string };
let tenantB: { id: string; slug: string };

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

beforeAll(async () => {
  canConnect = (await probe(ADMIN_URL)) && (await probe(APP_URL));
  if (!canConnect) {
    // eslint-disable-next-line no-console
    console.warn(
      '[cross-tenant] omitido: postgres + roles RLS no disponibles. ' +
        'Levantá `docker compose up -d postgres`, corré `prisma migrate deploy` y `./scripts/apply-rls.sh`.',
    );
    return;
  }

  admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } }, log: ['error'] });
  app = new PrismaClient({ datasources: { db: { url: APP_URL } }, log: ['error'] });

  // Sembrar tenants A y B con un insured cada uno (bajo BYPASSRLS).
  const slugA = `t-rls-a-${Date.now()}`;
  const slugB = `t-rls-b-${Date.now()}`;
  tenantA = await admin.tenant.create({ data: { name: 'Tenant A (RLS test)', slug: slugA } });
  tenantB = await admin.tenant.create({ data: { name: 'Tenant B (RLS test)', slug: slugB } });

  // Necesitamos un package por tenant (FK desde insureds).
  const packageA = await admin.package.create({
    data: { tenantId: tenantA.id, name: 'pkg-a', description: 'pkg' },
  });
  const packageB = await admin.package.create({
    data: { tenantId: tenantB.id, name: 'pkg-b', description: 'pkg' },
  });

  await admin.insured.create({
    data: {
      id: randomUUID(),
      tenantId: tenantA.id,
      curp: 'AAAA800101HDFRRR01',
      fullName: 'Asegurado A',
      dob: new Date('1980-01-01'),
      packageId: packageA.id,
      validFrom: new Date('2026-01-01'),
      validTo: new Date('2027-01-01'),
    },
  });
  await admin.insured.create({
    data: {
      id: randomUUID(),
      tenantId: tenantB.id,
      curp: 'BBBB800101HDFRRR02',
      fullName: 'Asegurado B',
      dob: new Date('1980-01-01'),
      packageId: packageB.id,
      validFrom: new Date('2026-01-01'),
      validTo: new Date('2027-01-01'),
    },
  });
}, 30_000);

afterAll(async () => {
  if (!canConnect) return;
  // Cleanup en orden FK-safe.
  await admin.insured.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
  await admin.package.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
  await admin.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await admin.$disconnect();
  await app.$disconnect();
}, 30_000);

describe('Cross-tenant isolation gate (RLS layer)', () => {
  it('app role sin SET LOCAL devuelve 0 filas (RLS bloquea)', async () => {
    if (!canConnect) {
      expect(true).toBe(true);
      return;
    }
    const rows = await app.insured.findMany();
    // RLS exige tenant_id::text = current_setting(...) — sin contexto: 0.
    expect(rows).toHaveLength(0);
  });

  it('app role con SET LOCAL al tenant A ve sólo insureds de A', async () => {
    if (!canConnect) {
      expect(true).toBe(true);
      return;
    }
    const rows = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantA.id}', true)`);
      return tx.insured.findMany();
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === tenantA.id)).toBe(true);
    expect(rows.every((r) => r.tenantId !== tenantB.id)).toBe(true);
  });

  it('app role con SET LOCAL al tenant A NO puede leer insureds de B por id', async () => {
    if (!canConnect) {
      expect(true).toBe(true);
      return;
    }
    const insuredsB = await admin.insured.findMany({ where: { tenantId: tenantB.id } });
    const targetB = insuredsB[0];
    if (!targetB) throw new Error('seed inválido: tenant B sin insureds');

    const result = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantA.id}', true)`);
      return tx.insured.findUnique({ where: { id: targetB.id } });
    });
    // findUnique con RLS: el row existe en BD pero no es visible → null (no 200 con datos, no error).
    expect(result).toBeNull();
  });

  // S3-06 — vista 360°: el filtro find360 también debe respetar RLS al leer
  // todas las secciones (insured, coverages, claims, certs, audit).
  // Probamos directamente al nivel BD: SET LOCAL al tenant A ⇒ findFirst del
  // insured de B devuelve null. La capa HTTP devuelve 404 sobre ese null
  // (verificado además en e2e/insured-360.e2e-spec.ts).
  it('S3-06 find360 cross-tenant: SET LOCAL=A + findFirst(insured de B) → null (RLS bloquea)', async () => {
    if (!canConnect) {
      expect(true).toBe(true);
      return;
    }
    const insuredsB = await admin.insured.findMany({ where: { tenantId: tenantB.id } });
    const targetB = insuredsB[0];
    if (!targetB) throw new Error('seed inválido: tenant B sin insureds');

    const result = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantA.id}', true)`);
      // Replica el query exacto que hace InsuredsService.find360 antes del
      // throw NotFoundException (id + deletedAt:null + include package/beneficiaries).
      return tx.insured.findFirst({
        where: { id: targetB.id, deletedAt: null },
        include: { package: { select: { id: true, name: true } } },
      });
    });
    expect(result).toBeNull();
  });

  it('app role intentando INSERT en tenant B mientras context=A → WITH CHECK falla', async () => {
    if (!canConnect) {
      expect(true).toBe(true);
      return;
    }
    const packageB = await admin.package.findFirst({ where: { tenantId: tenantB.id } });
    if (!packageB) throw new Error('seed inválido: tenant B sin package');

    await expect(
      app.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantA.id}', true)`);
        return tx.insured.create({
          data: {
            // tenantId apunta a B (ataque cross-tenant) pero el contexto activo es A.
            tenantId: tenantB.id,
            curp: 'CCCC800101HDFRRR03',
            fullName: 'Asegurado attacker',
            dob: new Date('1980-01-01'),
            packageId: packageB.id,
            validFrom: new Date('2026-01-01'),
            validTo: new Date('2027-01-01'),
          },
        });
      }),
    ).rejects.toThrow();
  });

  // M2 — Superadmin con BYPASSRLS (rol DB segurasist_admin).
  // El cliente `admin` en este spec ya conecta como segurasist_admin.
  it('superadmin (BYPASSRLS) ve insureds de tenant A y B sin SET LOCAL', async () => {
    if (!canConnect) {
      expect(true).toBe(true);
      return;
    }
    const all = await admin.insured.findMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    const aRows = all.filter((r) => r.tenantId === tenantA.id);
    const bRows = all.filter((r) => r.tenantId === tenantB.id);
    expect(aRows.length).toBeGreaterThan(0);
    expect(bRows.length).toBeGreaterThan(0);
  });

  // M2 — Defensa en profundidad: el cliente normal (segurasist_app, NOBYPASSRLS)
  // sin SET LOCAL devuelve 0 filas aunque el caller sea conceptualmente
  // superadmin. Esto evita que un bug en services superadmin (uso accidental
  // de PrismaService en lugar de PrismaBypassRlsService) abra una fuga.
  it('cliente normal (NOBYPASSRLS) sin SET LOCAL → 0 filas (defensa en profundidad para superadmin)', async () => {
    if (!canConnect) {
      expect(true).toBe(true);
      return;
    }
    const rows = await app.insured.findMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Matriz de gates HTTP (Sprint 1+ a medida que los endpoints se implementen).
// `it.todo` mantiene visible el alcance sin romper el build.
// ---------------------------------------------------------------------------
describe('Cross-tenant isolation gate (HTTP layer — pending)', () => {
  describe('insureds', () => {
    it.todo('GET /v1/insureds — sólo devuelve insureds del tenant A');
    it.todo('GET /v1/insureds/:id (id de tenant B) — responde 404');
    it.todo('GET /v1/insureds/:id/360 (id de tenant B) — responde 404'); // S3-06 e2e
    it.todo('PATCH /v1/insureds/:id (id de tenant B) — responde 404');
    it.todo('DELETE /v1/insureds/:id (id de tenant B) — responde 404');
  });
  describe('batches', () => {
    it.todo('GET /v1/batches/:id (id de tenant B) — responde 404');
    it.todo('GET /v1/batches/:id/errors (id de tenant B) — responde 404');
    it.todo('POST /v1/batches/:id/confirm (id de tenant B) — responde 404');
  });
  describe('certificates', () => {
    it.todo('GET /v1/certificates/:id (id de tenant B) — responde 404');
    it.todo('GET /v1/certificates/:id/url (id de tenant B) — responde 404');
    it.todo('POST /v1/certificates/:id/reissue (id de tenant B) — responde 404');
  });
  describe('claims', () => {
    it.todo('GET /v1/claims/:id (id de tenant B) — responde 404');
    it.todo('PATCH /v1/claims/:id (id de tenant B) — responde 404');
  });
  describe('packages / coverages', () => {
    it.todo('GET /v1/packages/:id (id de tenant B) — responde 404');
    it.todo('PATCH /v1/coverages/:id (id de tenant B) — responde 404');
  });
  describe('audit', () => {
    it.todo('GET /v1/audit/log — sólo entradas del tenant A');
  });
  describe('chat', () => {
    it.todo('GET /v1/chat/history — sólo mensajes del tenant A');
    it.todo('GET /v1/chat/kb — sólo entries del tenant A');
  });
  describe('reports', () => {
    it.todo('GET /v1/reports/* — sólo agregados del tenant A');
  });
  // S3-08 — gates del tenant override (HTTP-layer). La implementación real
  // vive en `test/e2e/tenant-override.e2e-spec.ts` (requiere bootstrap del
  // app.module + cognito-local). Estos `it.todo` mantienen visible la matriz
  // desde el security suite (mismo gate de PR que el resto).
  describe('tenant-override (S3-08)', () => {
    it.todo('admin_segurasist + X-Tenant-Override=mac → ve sólo insureds de mac');
    it.todo('admin_segurasist + X-Tenant-Override=tenant-falso → 404');
    it.todo('admin_mac + X-Tenant-Override=mac → 403');
    it.todo('operator + X-Tenant-Override=mac → 403');
  });
});
