## [MT-4 iter 2] 2026-04-28
**Owner**: MT-4 (QA Multi-Tenant Senior)
**Estado**: COMPLETE — 2 de 3 CC cerrados; CC-24 (unskip) deferred a orchestrator (gating por timestamps de iter 2 de MT-1/MT-3/S5-3/DS-1, no publicados al momento de cierre).

### Plan iter 2

- CC-07 — `cognito-local-bootstrap.sh --multi-tenant` flag.
- CC-10 — Re-evaluar 403 vs 404 cross-leak; alinear test E2E con la decisión.
- CC-24 — Unskip 4 E2E + commit baselines (gated por finishers).

### Hechos

#### CC-07 — bootstrap multi-tenant

- `segurasist-api/scripts/cognito-local-bootstrap.sh` reescrito con flag parsing
  (--multi-tenant | --tenants slug1,slug2,...) + loop por tenant. Default sin
  flag mantiene comportamiento Sprint 1 (solo `mac`) — **no breaking**.
- Tenant resolution: arrays paralelos `TENANT_SLUGS[]` / `TENANT_IDS[]` (bash
  3.x friendly para macOS). FATAL si algún slug no existe en BD.
- User mapping per slug:
  - `admin@<slug>.local` (rol `admin_mac`)
  - `operator@<slug>.local`
  - `supervisor@<slug>.local`
  - `insured.demo@<slug>.local` (pool `local_insured`, custom:tenant_id correcto)
- Override back-compat para slug `mac`: `admin@mac.local` con `ADMIN_PASSWORD`
  (no `DEMO_PASSWORD`); insured demo conserva `given_name=María` /
  `family_name=Hernández` (H-27).
- Superadmin (`superadmin@segurasist.local`) se crea solo una vez (cross-tenant,
  no se loopea).
- Summary block dinámico (array `SUMMARY_ROWS[]`) — la tabla final lista todos
  los usuarios creados, con tenant id + sub.
- `docs/access/credentials-dev.md` (NEW) — documenta el comando, tabla
  completa de usuarios, CURPs seedeados, idempotencia, smoke-test curl.
- Validación: `bash -n` no se pudo correr en sandbox (denied), pero la
  estructura es estándar bash 3.2+ (arrays + read -a + IFS); revisado
  manualmente — no hay nesting issue ni quoting roto.

#### CC-10 — cross-leak 404 (decisión MANTENER)

- **Decisión**: MANTENER 404 (no migrar a 403). Razones:
  1. `segurasist-api/src/modules/insureds/insureds.service.ts:431` ya emite
     `NotFoundException` cuando el row no es visible (RLS deniega o id no
     existe). Indistinguibilidad "no existe / no autorizado" es OWASP-aligned.
  2. `insureds.controller.ts:116-118` documenta explícitamente la decisión
     anti-enumeration en el doc-block de `find360` ("NO 403, para no leakear
     UUIDs guess-resistantes").
  3. SecOps preference (vía DISPATCH_PLAN MVP_08 §enumeration): 403 filtra
     existencia → vector de enumeración por brute force de UUID hash space.
- **Acción**: actualicé `tests/e2e/multi-tenant-portal.spec.ts` test 4
  (cross-leak) para esperar `404` en lugar de `403`. Doc-block del describe
  + header del archivo updated con la cita de la decisión.
- **Out-of-scope**: NO modifiqué `insureds.service.ts` (ya está correcto).
  No requiere cambio en MT-1/S5-1.

#### CC-24 — unskip status

- **NO unskippeado.** Razón: a la hora de cierre de MT-4 iter 2 (2026-04-28),
  ningún agente upstream (MT-1, MT-3, S5-3, DS-1) ha publicado su
  `*-iter2.md` en `docs/sprint5/feed/`. Sin esa entrega, los endpoints
  (`/v1/tenants/me/branding`, `PUT /v1/admin/tenants/:id/branding`),
  TenantBrandingProvider con purge en logout, y `data-motion-ready` para
  snapshots determinísticos no están confirmados como ready.
- **Test 4 (cross-leak)**: el spec ya está corregido para 404 — cuando se
  unskippe, no requiere re-trabajo.
- **Baselines visual regression**: NO se ejecutó `playwright test
  --update-snapshots` — el sandbox no tiene Playwright + browsers + stack
  Docker arriba. Documentación exacta para el orchestrator abajo.

### TODO orchestrator (cerrar CC-24 cuando finishers publiquen iter 2)

Cuando MT-1-iter2.md, MT-3-iter2.md, S5-3-iter2.md, DS-1-iter2.md existan:

```bash
# 0) Pre-requisitos: stack arriba + seeds + bootstrap multi-tenant.
docker compose up -d
cd segurasist-api
npx prisma migrate deploy && npx prisma db seed
npx tsx prisma/seed-multi-tenant.ts
./scripts/cognito-local-bootstrap.sh --multi-tenant

# 1) Quitar `it.skip` (4 specs):
#    - tests/e2e/multi-tenant-portal.spec.ts → reemplazar `test.skip(` por
#      `test(` en líneas 116, 147, 167, 198 (test 1, 2, 3, 4).
#    - tests/e2e/admin-branding-roundtrip.spec.ts → reemplazar `test.skip(`
#      por `test(` en línea 111.
#    - tests/visual-regression/portal-tenant-a.spec.ts → reemplazar
#      `test.skip(` por `test(` en líneas 99 y 112.

# 2) Generar baselines visual regression (primera corrida):
cd /Users/ablz/Documents/Claude/Projects/SegurAsist/SaaS
PORTAL_BASE_URL=http://localhost:3002 \
  npx playwright test \
    --config tests/e2e/playwright.config.ts \
    --project visual-regression \
    --update-snapshots

# 3) Verificar baselines generados (deben aparecer en
#    tests/visual-regression/__screenshots__/):
ls tests/visual-regression/__screenshots__/
#    Esperado: portal-tenant-a-dashboard.png, portal-tenant-b-dashboard.png

# 4) Commit explícito (no auto):
git add tests/visual-regression/__screenshots__/portal-tenant-a-dashboard.png
git add tests/visual-regression/__screenshots__/portal-tenant-b-dashboard.png
git commit -m "MT-4 iter2: commit visual regression baselines (CC-24)"

# 5) Verificar que la 2da corrida pasa contra los baselines:
ADMIN_TEST_TOKEN=<jwt-superadmin> \
  npx playwright test --config tests/e2e/playwright.config.ts
```

### NEW-FINDING

1. **Override emails para `mac`**. El bootstrap multi-tenant respeta
   `ADMIN_EMAIL` env var solo para el slug `mac` (back-compat). Otros slugs
   asumen el patrón `admin@<slug>.local`. Si en el futuro hay tenants con
   email-domain custom (e.g. `admin@hospitales-mac.com.mx`), el bootstrap
   necesita un mapping JSON de slug→email. Workaround actual: setear
   `ADMIN_EMAIL` con el slug primario de la lista. Defer Sprint 6 si > 2
   tenants.

2. **Bash 3.2 limitation en macOS**. El bootstrap usa arrays paralelos en
   lugar de associative arrays (declare -A) por compatibilidad con bash 3.2
   (default macOS). Si en CI Linux pasamos a bash 4+, vale la pena
   refactorizar a `declare -A SLUG_TO_ID` para legibilidad.

3. **Insured pool cross-tenant collision**. El pool `local_insured` ahora
   tiene 2 emails (`insured.demo@mac.local` + `insured.demo@demo-insurer.local`)
   con distintos `custom:tenant_id`. Cognito-local NO valida unicidad de
   email entre custom attributes — un atacante que conozca un email válido
   en otro tenant podría intentar OTP. La defensa real está en
   `auth.service.ts` que cruza `(email, tenant_id)` con la tabla `users`
   antes de emitir OTP. **Acción para iter 3 / Sprint 6**: validar que el
   service efectivamente niega login cuando el email existe en pool pero
   NO en `users` con ese tenant. Test pending.

4. **Decisión 404 documentada en 3 lugares**: (a) doc-block del `find360`
   en controller, (b) `insureds.service.ts:430` ("nunca distinguimos no
   existe vs no autorizado"), (c) test E2E header. Recomiendo a S5-1 / G-2
   añadir un caso explícito al ZAP DAST baseline (pasivo) que verifique la
   ausencia de respuestas 403 en endpoints `/v1/insureds/:id` cross-tenant
   para que la decisión no se rompa por un refactor accidental.

5. **Visual regression flake risk persiste** (heredado iter 1, NEW-FINDING #4).
   Aunque el spec usa `animations: 'disabled'`, los Lordicons web-component
   custom-elements no respetan ese flag de Playwright (no es CSS animation
   estándar). DS-1 debe garantizar que `prefers-reduced-motion: reduce` (o
   `data-motion-ready`) realmente detiene el render del lord-icon en estado
   final antes del snapshot. Sin esto, la primera corrida con
   `--update-snapshots` puede capturar un frame intermedio del icon. Bloqueo
   soft — el orchestrator debe re-correr el snapshot 2-3 veces si ve flake.

### Bloqueos para iter 2 → cierre Sprint 5

Ninguno por parte de MT-4. CC-24 es un follow-up gated por finishers, no un
blocker activo.

### Para iter 3 / Sprint 6 (cross-cutting)

1. Validar service `auth.service.ts` deniega OTP cross-tenant (NEW-FINDING #3).
2. Add ZAP test que `/v1/insureds/:id` cross-tenant NO devuelve 403 (NEW-FINDING #4).
3. Refactor bootstrap a `declare -A` cuando minimum bash version del CI sea ≥4.
4. Snapshot helper para Lordicons (DS-1 contract) — eliminar flake.
5. Si surgen >2 tenants con email-domain real, JSON config para slug→email mapping.

### Métricas iter 2

| Item | Cantidad |
|---|---|
| Scripts modificados | 1 (`cognito-local-bootstrap.sh`, +75 líneas / -8 líneas) |
| Specs modificados | 1 (`multi-tenant-portal.spec.ts` — header doc + test 4 expect 404) |
| Docs nuevos | 2 (`credentials-dev.md`, `MT-4-iter2.md`) |
| `it.skip` removidos | 0 (gated por finishers) |
| Baselines visual regression generados | 0 (sandbox sin Playwright; instrucción exacta en TODO) |
| NEW-FINDINGs | 5 |
| CC cerrados directamente | 2 (CC-07, CC-10) |
| CC con TODO documentado | 1 (CC-24) |
