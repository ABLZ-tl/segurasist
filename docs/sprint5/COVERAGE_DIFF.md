# Sprint 5 — Coverage Diff (G-2 iter 2)

**Owner**: G-2 (QA Performance + DAST).
**Fecha**: 2026-04-28.
**Esperado**: este doc se llena en validation gate D5 con números reales tras
correr la suite completa post-Sprint 5. Iter 2 deja estructura final +
comandos; orchestrator rellena las celdas con `pnpm test --coverage`.

## Comando para llenar

```bash
# 1) API (NestJS) — coverage por módulo (lcov + json-summary)
pnpm --filter segurasist-api test --run --coverage --reporter=json-summary

# 2) Web — admin + portal
pnpm --filter admin test --run --coverage --reporter=json-summary
pnpm --filter portal test --run --coverage --reporter=json-summary

# 3) Packages (security, ui)
pnpm --filter @segurasist/security test --run --coverage
pnpm --filter @segurasist/ui test --run --coverage

# 4) Snapshot diff vs Sprint 4 (asume baseline en docs/qa/SPRINT4_DOR_DOD.md)
node scripts/coverage-diff.mjs \
  --sprint4 docs/qa/SPRINT4_DOR_DOD.md \
  --sprint5-api segurasist-api/coverage/coverage-summary.json \
  --sprint5-admin segurasist-web/apps/admin/coverage/coverage-summary.json \
  --sprint5-portal segurasist-web/apps/portal/coverage/coverage-summary.json \
  --output docs/sprint5/COVERAGE_DIFF.md
```

> Si `scripts/coverage-diff.mjs` no existe aún, llenar tabla manualmente desde
> los `coverage-summary.json` (vitest/jest los emiten en `coverage/`).

## Coverage thresholds (DEVELOPER_GUIDE.md regla dura)

- **Default**: 60 statements / 55 branches / 60 functions / 60 lines.
- **Security-critical** (auth, rls, security pkg): 80 / 75 / 80 / 80.

## Tabla comparativa Sprint 4 → Sprint 5 (esquema final iter 2)

> **Esquema simplificado** (G-2 iter 2): columnas `module | before | after |
> delta`. Los números son `% statements` (proxy estable). Branch/func/lines
> quedan en el JSON crudo `coverage-summary.json` por módulo (artifact CI).
> Orchestrator rellena en validation gate D5 con `pnpm test --coverage`.

| module | before (S4 %) | after (S5 %) | delta | threshold | pass? |
|---|---|---|---|---|---|
| `segurasist-api` (global) | TODO | TODO | TODO | 60 | TODO |
| `segurasist-api` `auth/*` | TODO | TODO | TODO | 80 | TODO |
| `segurasist-api` `auth/saml/*` (NUEVO S5-1) | n/a | TODO | NEW | 80 | TODO |
| `segurasist-api` `scim/*` (NUEVO S5-1) | n/a | TODO | NEW | 80 | TODO |
| `segurasist-api` `tenants/branding/*` (NUEVO MT-1) | n/a | TODO | NEW | 60 | TODO |
| `segurasist-api` `chatbot/kb-admin/*` (NUEVO S5-3) | n/a | TODO | NEW | 60 | TODO |
| `segurasist-api` `chatbot/conversations-history/*` (NUEVO S5-3) | n/a | TODO | NEW | 60 | TODO |
| `apps/admin` (global) | TODO | TODO | TODO | 60 | TODO |
| `apps/admin` `branding-editor/*` (NUEVO MT-2) | n/a | TODO | NEW | 60 | TODO |
| `apps/portal` (global) | TODO | TODO | TODO | 60 | TODO |
| `apps/portal` `tenant/*` (NUEVO MT-3) | n/a | TODO | NEW | 60 | TODO |
| `packages/ui` (global) | TODO | TODO | TODO | 60 | TODO |
| `packages/ui` `animations/*` (NUEVO DS-1) | n/a | TODO | NEW | 60 | TODO |
| `packages/ui` `lord-icon/*` (NUEVO DS-1) | n/a | TODO | NEW | 60 | TODO |
| `packages/security` | TODO | TODO | TODO | 80 | TODO |

**Cómo llenar**:
1. Correr `pnpm test --coverage` en cada paquete (script de validation D5).
2. Leer `coverage-summary.json` → campo `total.statements.pct`.
3. Sustituir `TODO` por el valor; calcular `delta = after - before`.
4. `pass?` = `Y` si `after >= threshold`; `N` → bloquea Go-Live.

## Test counts

| Métrica | Sprint 4 (post) | Sprint 5 (target) | Sprint 5 (real) |
|---|---|---|---|
| Test files | TODO | TODO | TODO |
| Tests passing | 1222 | ≥ 1222 + módulos nuevos | TODO |
| Tests failing | 0 | 0 (regla dura) | TODO |
| E2E specs | TODO | +3 (multi-tenant, branding-roundtrip, visual) | TODO |

## Regla dura

**Si tests existentes 1222/1222 fallan → BLOQUEA Go-Live día 30.** El brief
del DISPATCH_PLAN explícito: "Tests existentes 1222/1222 NO se pueden romper.
Si tu cambio rompe tests del paquete chatbot/reports/audit-timeline ya verdes,
ARREGLA en iter 2 — no lo dejes a validation gate."
