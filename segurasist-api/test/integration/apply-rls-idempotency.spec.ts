/**
 * C-15 — Integration test: `apply-rls.sh` es idempotente y cubre TODAS las
 * tablas con `tenant_id` declaradas en `prisma/schema.prisma`.
 *
 * Cubre:
 *   1. Ejecutar el script DOS veces consecutivas no falla.
 *   2. La cantidad de policies por tabla NO crece tras la segunda ejecución
 *      (script usa `DROP POLICY IF EXISTS` antes de crear → estable en 2/tabla).
 *   3. La tabla `exports` (regresión histórica del bundle B-RLS) tiene su
 *      pareja de policies post-apply (select + modify).
 *   4. Drift check: comparamos la lista de tablas con `tenant_id` en el schema
 *      vs la lista en `policies.sql` (parseo del array `tables TEXT[]`). Si el
 *      schema agrega una nueva tabla y `policies.sql` la omite, este test falla
 *      como tripwire para el próximo PR.
 *
 * Ejecución:
 *   - Por defecto el bloque (1)+(2)+(3) requiere `RLS_E2E=1` + `PGURL` apuntando
 *     a un Postgres con permisos de superuser y schema migrado. Si no está
 *     seteado, el test queda en `it.skip` (no rompe CI sin docker).
 *   - El bloque (4) corre SIEMPRE (parseo estático de schema.prisma + policies.sql).
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const SCRIPT = resolve(ROOT, 'scripts/apply-rls.sh');
const POLICIES_SQL = resolve(ROOT, 'prisma/rls/policies.sql');
const SCHEMA_PRISMA = resolve(ROOT, 'prisma/schema.prisma');

const RLS_E2E = process.env.RLS_E2E === '1';
const PGURL = process.env.PGURL ?? 'postgresql://segurasist:segurasist@localhost:5432/segurasist';

/**
 * Parseo defensivo: extrae los nombres de tabla del array TEXT[] en
 * `policies.sql`. No es un parser SQL real, sólo acepta el formato actual.
 */
function parsePoliciesTables(): string[] {
  const sql = readFileSync(POLICIES_SQL, 'utf8');
  // Match `tables TEXT[] := ARRAY[ ... ];` — no greedy hasta `];`.
  const m = sql.match(/tables\s+TEXT\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]\s*;/);
  if (!m) throw new Error('No se pudo parsear el array `tables` en policies.sql');
  const body = m[1] ?? '';
  // Cada entry: 'name' (con posibles comentarios `--` después). Capturamos
  // strings entre comillas simples.
  const matches = [...body.matchAll(/'([^']+)'/g)].map((mm) => mm[1] ?? '');
  return matches.filter(Boolean);
}

/**
 * Extrae nombres de tablas (`@@map("...")`) cuyos models declaran
 * `tenant_id`/`tenantId @map("tenant_id")`. Excluye `Tenant` (el catálogo)
 * porque no aplica RLS por tenant_id sobre sí mismo.
 */
function parseSchemaTablesWithTenantId(): string[] {
  const schema = readFileSync(SCHEMA_PRISMA, 'utf8');
  // Split por `model XXX {` blocks.
  const blocks = schema.split(/\nmodel\s+/).slice(1);
  const out: string[] = [];
  for (const block of blocks) {
    // Nombre del modelo es el primer token; lo ignoramos (usamos @@map).
    // Patrón: línea con `tenantId <Type[?]> @map("tenant_id") ...`. Aceptamos
    // cualquier whitespace/atributo intermedio.
    const hasTenantId = /\btenantId\b[^\n]*@map\("tenant_id"\)/.test(block);
    if (!hasTenantId) continue;
    const mapMatch = block.match(/@@map\("([^"]+)"\)/);
    const tableName = mapMatch?.[1];
    if (!tableName) continue;
    if (tableName === 'tenants') continue; // el catálogo no aplica RLS por tenant_id.
    out.push(tableName);
  }
  return out;
}

describe('apply-rls.sh — idempotency + drift check (C-15)', () => {
  it('artefactos esperados existen', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    expect(existsSync(POLICIES_SQL)).toBe(true);
    expect(existsSync(SCHEMA_PRISMA)).toBe(true);
  });

  // ── Drift check (corre SIEMPRE, sin DB) ──────────────────────────────────
  describe('drift check: schema.prisma ↔ policies.sql', () => {
    it('TODAS las tablas con tenant_id en schema están en policies.sql', () => {
      const schemaTables = parseSchemaTablesWithTenantId().sort();
      const policiesTables = parsePoliciesTables().sort();

      // Sanity: el parser NO debe devolver listas vacías por bugs de regex.
      expect(schemaTables.length).toBeGreaterThan(0);
      expect(policiesTables.length).toBeGreaterThan(0);

      const missing = schemaTables.filter((t) => !policiesTables.includes(t));
      const extra = policiesTables.filter((t) => !schemaTables.includes(t));

      if (missing.length > 0) {
        // eslint-disable-next-line no-console
        console.error('[apply-rls drift] Tablas con tenant_id en schema pero NO en policies.sql:', missing);
      }
      if (extra.length > 0) {
        // eslint-disable-next-line no-console
        console.warn('[apply-rls drift] policies.sql cubre tablas que NO existen en schema:', extra);
      }

      expect(missing).toEqual([]);
    });

    it('incluye tabla `exports` (regresión C-15)', () => {
      const policiesTables = parsePoliciesTables();
      expect(policiesTables).toContain('exports');
    });

    it('incluye tabla `system_alerts` (NEW-FINDING F3 iter1)', () => {
      const policiesTables = parsePoliciesTables();
      expect(policiesTables).toContain('system_alerts');
    });
  });

  // ── Idempotency real contra DB (gateado por RLS_E2E=1) ────────────────────
  const dbDescribe = RLS_E2E ? describe : describe.skip;
  dbDescribe('idempotency contra Postgres real (RLS_E2E=1)', () => {
    function run(cmd: string): string {
      return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    }

    function countPoliciesForTable(table: string): number {
      const out = run(
        `psql "${PGURL}" -tAc "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='${table}';"`,
      ).trim();
      return Number.parseInt(out, 10) || 0;
    }

    it('2 ejecuciones consecutivas → mismo conteo de policies (idempotente)', () => {
      // Primera ejecución.
      run(`PGURL='${PGURL}' bash "${SCRIPT}"`);
      const tables = parsePoliciesTables();
      const firstCount: Record<string, number> = {};
      for (const t of tables) firstCount[t] = countPoliciesForTable(t);

      // Segunda ejecución.
      run(`PGURL='${PGURL}' bash "${SCRIPT}"`);
      const secondCount: Record<string, number> = {};
      for (const t of tables) secondCount[t] = countPoliciesForTable(t);

      // Cada tabla debe tener exactamente 2 policies (select + modify) y
      // estable entre ejecuciones.
      for (const t of tables) {
        expect(secondCount[t]).toBe(firstCount[t]);
        expect(secondCount[t]).toBe(2);
      }
    }, 60_000);

    it('tabla `exports` tiene policies select + modify post-apply', () => {
      run(`PGURL='${PGURL}' bash "${SCRIPT}"`);
      const policies = run(
        `psql "${PGURL}" -tAc "SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='exports' ORDER BY policyname;"`,
      )
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      expect(policies).toEqual(expect.arrayContaining(['p_exports_modify', 'p_exports_select']));
    }, 30_000);
  });
});
