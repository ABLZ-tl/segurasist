## [MT-4 iter 1] 2026-04-28
**Owner**: MT-4 (QA Multi-Tenant Senior)
**Estado**: COMPLETE (con `it.skip` esperando MT-1 + MT-3 iter 1)

### Plan

Implementar suite QA Sprint 5 sin esperar a MT-1/MT-3:
1. Seed multi-tenant idempotente (2 tenants A+B + 2 insureds + admin + paquete + 4 coberturas).
2. E2E cross-tenant cross-leak (4 tests, 5+ assertions).
3. E2E admin → portal branding roundtrip con cleanup.
4. Visual regression Playwright tenant A vs tenant B (snapshots).
5. Vitest sanity cross-tenant.
6. DoR/DoD placeholder consolidable por DS-1.
7. Runner script con reportes timestamped.

### Hechos

- `segurasist-api/prisma/seed-multi-tenant.ts` — seed completo idempotente con TENANTS = `mac` + `demo-insurer` (primaryHex `#16a34a` / `#dc2626`, taglines, displayNames). Coverages mapeadas a enum real (`consultation`/`emergency`/`hospitalization`/`laboratory`).
- `tests/e2e/multi-tenant-portal.spec.ts` — 4 tests:
  1. login A1 → branding A renderizado (5 assertions: displayName, tagline, CSS var, ausencia displayName B, GET branding API contract).
  2. /coverages tenant A solo → tenantIds.size === 1.
  3. logout + login B1 → branding muta sin reload manual; cookie purgada.
  4. cross-leak GET /api/proxy/v1/insureds/{insuredB.id} con sesión A1 → 403 + body sin PII de B.
- `tests/e2e/admin-branding-roundtrip.spec.ts` — 1 test multi-context (admin context + portal context). `afterEach` revierte primaryHex a `#16a34a` (cleanup idempotente). Asserts: form save → toast → otra ventana lee `--tenant-primary` nuevo.
- `tests/visual-regression/portal-tenant-a.spec.ts` — 2 tests (tenant A baseline + tenant B baseline). `maxDiffPixelRatio: 0.02`, `animations: 'disabled'`, viewport 1280x800.
- `tests/e2e/playwright.config.ts` — root config separado del de `segurasist-web/tests/e2e/` (Sprint 1) para no pisar sus reportes; 2 projects (`sprint5-multi-tenant` + `visual-regression`).
- `tests/e2e/multi-tenant-portal.run.sh` — bash runner: smoke checks (curl :3000/:3001/:3002/:8025), Playwright invocation, reports → `tests/e2e/reports/sprint5-<TS>/{html,test-results}/`.
- `segurasist-web/apps/portal/test/integration/cross-tenant.spec.tsx` — 4 specs Vitest sanity sobre `TenantBrandingContext` con stub `BrandedHeaderStub`. Verifica que displayName/CSS var muta entre A↔B; default no fugea a tenants seedeados.
- `docs/qa/SPRINT5_DOR_DOD.md` — placeholder con DoR (10/10 ✅), DoD por agente checklist, Validation gate D5 (11 items ⏳ post-iter 2).
- `docs/sprint5/feed/MT-4-iter1.md` — este documento.

### NEW-FINDING

1. **Cognito-local bootstrap es single-tenant** (`scripts/cognito-local-bootstrap.sh:81` query slug='mac' hardcoded). Para que los E2E del nuevo seed funcionen end-to-end, MT-1 (o un agente infra) debe extender el bootstrap para iterar sobre todos los tenants en DB. Propuesta: agregar `--multi-tenant` flag que loopea `SELECT slug FROM tenants` y registra admin/insured cognito-local por tenant. Mientras esto no exista, los specs E2E quedan `it.skip`.

2. **Logout en portal no purga TenantBrandingProvider explícitamente** (componente `apps/portal/components/tenant/tenant-context.tsx` solo expone Context, no hay setter). MT-3 debe garantizar que el logout (cookie clear) dispara remount del Provider, o exponer `useTenantBranding().reset()`. Sin esto, el branding A puede sobrevivir al login B durante el primer paint (FOUC). Test 3 de `multi-tenant-portal.spec.ts` lo cubre.

3. **CSP `style-src` y `<style>` inline para CSS vars dinámicos** — el portal CSP actual (Sprint 4) podría bloquear `<style>:root { --tenant-primary: ... }</style>` si `style-src` no incluye `'unsafe-inline'` o el nonce. MT-3 + MT-1 deben coordinar: o usar nonce dinámico (preferido) o pasar branding via `data-*` attributes y leerlos con CSS `attr()`. Propongo nonce — Sprint 4 ya tiene infra (`packages/security/src/csp.ts`).

4. **Visual regression flake risk** — Lordicons (lord-icon-element web component) y GSAP transitions van a producir diffs de >2% si el snapshot se toma antes del primer settle. DS-1 debe exponer un `data-motion-ready` attribute (o respetar `prefers-reduced-motion: reduce`) para que `animations: 'disabled'` realmente desactive todo. Pendiente acordar contrato.

5. **Endpoint `/api/proxy/v1/insureds/{insuredB.id}` cross-leak** — el RLS de Postgres protege el row, pero el proxy de Next podría devolver 500 (no 403) si Prisma lanza `Record not found` antes de que el guard responda. MT-1 debe garantizar 403 con body `{ "error": "FORBIDDEN" }` y NO 404 (404 filtraría existencia del id). Propuesta: matcher `expect(leakResp.status()).toBeOneOf([403])` — iter 2 valida.

### Bloqueos

- **MT-1**: endpoints `/v1/tenants/me/branding` (GET) + `/v1/admin/tenants/:id/branding` (PUT) + bootstrap multi-tenant cognito-local. Hasta entrega, los 7 specs E2E quedan `.skip` con motivo explícito en cada uno.
- **MT-3**: `TenantBrandingProvider` + branded header/sidebar/footer + logout purge. Sin esto, ni roundtrip ni cross-leak corren.
- **DS-1**: `data-motion-ready` para snapshot determinístico (visual regression). Bloqueo soft — los tests pasan con baselines re-generados, pero serían inestables sin esto.

### Para iter 2 / cross-cutting

1. Quitar `it.skip` de los 3 specs E2E + 1 visual regression cuando MT-1/MT-3 publiquen iter 1.
2. Generar y commitear baselines `tests/visual-regression/__screenshots__/portal-tenant-{a,b}-dashboard.png`.
3. Coordinar con MT-1 que `/v1/insureds/:id` con tenantId distinto → **403** (no 404).
4. Coordinar con MT-3 que logout dispara purge del TenantContext (test 3 lo afirma).
5. Pedir a DS-1 contrato `data-motion-ready` para snapshots estables.
6. Agregar al `package.json` root o `segurasist-api/package.json` un script `prisma:seed:multi-tenant` (out-of-scope MT-4 si MT-1 toca `package.json`).
7. Pedir a S5-3 / DS-1 confirmar que el menu user con "Cerrar sesión" tiene los selectores aria que test 3 asume (`role=button name=/perfil|menú/`, `role=menuitem name=/Cerrar sesión/`).
8. Consolidar `SPRINT5_DOR_DOD.md` con sello final DS-1 (gates ⏳ → ✅).

### Métricas iter 1

| Item | Cantidad |
|---|---|
| Specs E2E creados | 3 (`multi-tenant-portal`, `admin-branding-roundtrip`, `portal-tenant-a` visual) |
| Tests dentro | 4 + 1 + 2 = 7 (todos `it.skip` esperando MT-1/MT-3) |
| Vitest specs creados | 1 (`cross-tenant.spec.tsx`, 4 it() reales — NO skip) |
| Seeds nuevos | 1 (`seed-multi-tenant.ts`, 2 tenants idempotente) |
| Docs nuevos | 2 (`SPRINT5_DOR_DOD.md`, `MT-4-iter1.md`) |
| Scripts nuevos | 1 (`multi-tenant-portal.run.sh`) |
| Líneas totales escritas | ~900 (sin contar bloque del feed) |
