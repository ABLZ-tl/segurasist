/**
 * S3-07 — Performance test del search de insureds.
 *
 * Pre-requisito: tenant `mac` con ≥10k insureds. El script
 * `scripts/seed-bulk-insureds.sh` poblará 60k. Si la DB tiene <10k filas, el
 * suite se SKIPea automáticamente (CI rápido).
 *
 * Métrica: p95 ≤ 2s sobre 5 ejecuciones consecutivas (warm cache → cold no
 * aplica para search trigram porque la GIN se mantiene caliente).
 *
 * Diseño: golpea InsuredsService.list directo (sin HTTP roundtrip) para
 * aislar la latencia del query. Inyectamos un PrismaService request-scoped
 * minimalista con SET de tenant.
 */
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { AppConfigModule } from '@config/config.module';
import { InsuredsService, type InsuredsScope } from '@modules/insureds/insureds.service';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';

const PG_URL =
  process.env.DATABASE_URL ?? 'postgresql://segurasist:segurasist@localhost:5432/segurasist?schema=public';
const TENANT_SLUG = process.env.PERF_TENANT_SLUG ?? 'mac';
const MIN_ROWS = 10_000;

/** Calcula percentile sin dependencias. */
function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx] ?? 0;
}

describe('InsuredsService.list — perf p95 ≤ 2s con 60k filas', () => {
  let svc: InsuredsService;
  let bareClient: PrismaClient;
  let tenantId: string;
  let rowsInTenant = 0;
  let skipReason: string | null = null;

  beforeAll(async () => {
    bareClient = new PrismaClient({ datasources: { db: { url: PG_URL } }, log: ['error'] });
    try {
      await bareClient.$connect();
    } catch (err) {
      skipReason = `DB no disponible: ${(err as Error).message}`;
      return;
    }
    const t = await bareClient.tenant.findFirst({ where: { slug: TENANT_SLUG } }).catch(() => null);
    if (!t) {
      skipReason = `tenant '${TENANT_SLUG}' no existe; corre prisma db seed`;
      return;
    }
    tenantId = t.id;
    rowsInTenant = await bareClient.insured.count({ where: { tenantId } });
    if (rowsInTenant < MIN_ROWS) {
      skipReason = `tenant '${TENANT_SLUG}' tiene ${rowsInTenant} filas (<${MIN_ROWS}); corre scripts/seed-bulk-insureds.sh`;
      return;
    }

    // Construir InsuredsService con un PrismaService que use BYPASSRLS para
    // simplicidad del test (perf medimos al query, no al RLS overhead — RLS
    // sólo agrega ~1ms del SET LOCAL).
    process.env.DATABASE_URL_BYPASS = PG_URL;
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, ConfigModule],
      providers: [
        PrismaBypassRlsService,
        {
          provide: PrismaService,
          // PrismaService request-scoped — para el test usamos un wrapper
          // que expone `client` apuntando al cliente bypass.
          useFactory: (bypass: PrismaBypassRlsService): unknown => ({
            client: bypass.client,
            withTenant: async () => undefined,
          }),
          inject: [PrismaBypassRlsService],
        },
        InsuredsService,
      ],
    }).compile();
    svc = moduleRef.get(InsuredsService);
  }, 30_000);

  afterAll(async () => {
    if (bareClient) await bareClient.$disconnect();
  });

  it('por CURP parcial: 5 ejecuciones, p95 ≤ 2000ms', async () => {
    if (skipReason) {
      // eslint-disable-next-line no-console
      console.log(`[perf] SKIP: ${skipReason}`);
      return;
    }
    const scope: InsuredsScope = { platformAdmin: true, tenantId };
    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const t0 = Date.now();
      await svc.list({ q: 'PERF', limit: 50 }, scope);
      samples.push(Date.now() - t0);
    }
    const result = p95(samples);
    // eslint-disable-next-line no-console
    console.log(`[perf] CURP partial p95=${result}ms samples=${samples.join(',')}ms rows=${rowsInTenant}`);
    expect(result).toBeLessThanOrEqual(2000);
  }, 30_000);

  it('por nombre fuzzy: 5 ejecuciones, p95 ≤ 2000ms', async () => {
    if (skipReason) {
      // eslint-disable-next-line no-console
      console.log(`[perf] SKIP: ${skipReason}`);
      return;
    }
    const scope: InsuredsScope = { platformAdmin: true, tenantId };
    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const t0 = Date.now();
      await svc.list({ q: 'Apellido', limit: 50 }, scope);
      samples.push(Date.now() - t0);
    }
    const result = p95(samples);
    // eslint-disable-next-line no-console
    console.log(`[perf] name fuzzy p95=${result}ms samples=${samples.join(',')}ms`);
    expect(result).toBeLessThanOrEqual(2000);
  }, 30_000);

  it('filtros combinados q + status: 5 ejecuciones, p95 ≤ 2000ms', async () => {
    if (skipReason) {
      // eslint-disable-next-line no-console
      console.log(`[perf] SKIP: ${skipReason}`);
      return;
    }
    const scope: InsuredsScope = { platformAdmin: true, tenantId };
    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const t0 = Date.now();
      await svc.list({ q: 'PERF', status: 'active', limit: 50 }, scope);
      samples.push(Date.now() - t0);
    }
    const result = p95(samples);
    // eslint-disable-next-line no-console
    console.log(`[perf] combined q+status p95=${result}ms samples=${samples.join(',')}ms`);
    expect(result).toBeLessThanOrEqual(2000);
  }, 30_000);
});
