# Sprint 5 — Shared Features Feed

**Periodo**: días 26-30. Multi-tenant FE portal + Lordicons + GSAP + Sprint 5 features.
**Baseline**: 1222/1222 tests verdes post-Sprint 4.

## Iter 1 — Consolidación cross-cutting (post-completion 10 agentes)

### Estado

| Agente | Estado | Reporte | Notas |
|---|---|---|---|
| MT-1 | ✅ stalled-but-complete-on-disk | feed | BE+tests+migración+S3 TF, wired en app.module |
| MT-2 | ✅ | feed | 11 tests, RBAC roles reales |
| MT-3 | ✅ | feed | TenantProvider + branded layout + CSS vars |
| MT-4 | ✅ | feed | 4 E2E `it.skip` + visual regression + seeds 2 tenants |
| S5-1 | ✅ | feed | SAML+SCIM 22 tests + ADR-0009 + RB-019 |
| S5-2 | ✅ | feed | GuardDuty+SecHub Terraform + RB-020 + ADR-0010 |
| S5-3 | ✅ stalled-then-finisher | feed | BE+FE 35 tests, finisher cerró FE |
| G-1 | ✅ | feed | DR drill scripts + RB-018 + ADR-0011 (drill real diferido) |
| G-2 | ✅ | feed | DAST+perf scaffolding (run real diferido) |
| DS-1 | ✅ stalled-but-complete-on-disk | feed | Lordicons+GSAP+brandable+ADRs+UAT+freeze |

### Cross-cutting findings (asignados a iter 2)

| ID | Origen | Acción | Owner iter 2 |
|---|---|---|---|
| CC-01 | MT-3 | CSP rules viven en `next.config.mjs` (no `middleware.ts`); doc para futuras fases | MT-3 |
| CC-02 | MT-3 | COEP `require-corp` requiere CORP `cross-origin` en logos CDN | MT-1 (Terraform S3/CloudFront response_headers_policy) |
| CC-03 | MT-2 | `api()` wrapper no soporta multipart — bypass con `fetch()` directo | MT-2 (export `apiMultipart()` en api-client) |
| CC-04 | MT-2,S5-3 | Roles reales `admin_segurasist`/`admin_mac` (no "superadmin"/"tenant_admin") | DS-1 (DEVELOPER_GUIDE) |
| CC-05 | MT-2,MT-3 | Cache key `tenant-branding-self` para invalidación cruzada admin↔portal | MT-3 (verificar) |
| CC-06 | S5-1 | cognito-local NO soporta SAML — mock IdP fixtures necesarios | S5-1 |
| CC-07 | MT-4 | `cognito-local-bootstrap.sh:81` hardcodea slug='mac' — bloquea multi-tenant seed | MT-4 (flag `--multi-tenant`) |
| CC-08 | MT-4 | TenantContext sin setter — FOUC en logout | MT-3 (`resetBranding()` + hook logout) |
| CC-09 | MT-4 | `data-motion-ready` necesario para snapshots determinísticos | DS-1 |
| CC-10 | MT-4 | Cross-leak debe responder 403 (no 404 que filtra existencia) | S5-1/MT-1 (revisar guards insureds.controller) |
| CC-11 | G-2 | Charset SAML metadata `Content-Type: application/samlmetadata+xml; charset=UTF-8` | S5-1 |
| CC-12 | G-2 | Índice DB `(tenant_id, period_from)` en reports | (owner reports — sprint 4 S1; defer NEW-FINDING) |
| CC-13 | G-2 | Exclusión `/v1/auth/saml/acs` en DAST config | G-2 |
| CC-14 | S5-3 | CSV import limitado a 1MB; iter 2 streaming | S5-3 |
| CC-15 | DS-1,S5-3 | Catálogo Lordicon con TODO_ID — resolver vs cdn.lordicon.com | DS-1 |
| CC-16 | S5-1 | Audit wireup SAML/SCIM diferido a post-migration enum deploy | S5-1 |
| CC-17 | S5-1 | `policies.sql` array añadir `tenant_saml_config`, `tenant_scim_config` | S5-1 |
| CC-18 | S5-2 | `time_sleep` entre standards subscription y control disable | S5-2 |
| CC-19 | S5-2 | Lambda handlers placeholder (forwarder + quarantine) | S5-2 |
| CC-20 | G-1 | DR drill real no ejecutado — requires AWS staging access | G-1 (documentar pasos faltantes; placeholders explícitos) |
| CC-21 | MT-2,MT-3 | Stubs locales `_stubs.tsx`/`ds1-stubs.tsx` — swap a `@segurasist/ui` (DS-1 ya publicó) | MT-2 + MT-3 |
| CC-22 | MT-3 | SSR initial-data pre-fetch del branding para evitar flash | MT-3 |
| CC-23 | MT-3 | `style-src 'unsafe-inline'` activo — endurecer con nonce | MT-3 (defer Sprint 6 si grande) |
| CC-24 | MT-4 | Unskip 4 E2E + commit baselines | MT-4 |
| CC-25 | S5-2 | Slack webhook seedeo manual en SecretsManager — runbook | S5-2 |

---

## Iter 2 (consolidación)

(Agentes publicarán sus reportes acá)

### MT-4 iter 2 — 2026-04-28

| CC | Estado | Notas |
|---|---|---|
| CC-07 | ✅ closed | `--multi-tenant` flag + `--tenants slug1,slug2`; default sin breaking. `docs/access/credentials-dev.md` agregado. |
| CC-10 | ✅ closed (decision: KEEP 404) | Re-evaluado: 404 anti-enumeration MANTENIDO. Service ya emite `NotFoundException` en RLS-deny; controller documenta la decisión en `find360`. Test E2E actualizado para esperar 404 (era 403). NO se modifica BE. SecOps-aligned. |
| CC-24 | ⏳ deferred | TODO al orchestrator: unskip + `playwright --update-snapshots` cuando MT-1/MT-3/S5-3/DS-1 publiquen iter 2. Instrucción exacta en `feed/MT-4-iter2.md` §"TODO orchestrator". |

### G-1 iter 2 — 2026-04-28

| CC | Estado | Notas |
|---|---|---|
| CC-20 | ✅ plumbing closed (drill real diferido) | `segurasist-infra/modules/dr-drill-iam` con role `segurasist-dr-runner-staging` + tag-scoped IAM. Métrica `SegurAsist/DR.DrillFreshnessDays` publish wired al final de `99-runbook-helper.sh` (solo en `VALIDATION_STATUS=PASS`). Workflow `dr-drill-monthly.yml` ENABLED (`if: false` removed) con GitHub Environment `staging-dr`. Drill real sigue NO ejecutado — pre-req: Linear DR-DRILL-XX aprobado por Tech Lead + GitHub Environment protection rule (manual setup). Detalle en `feed/G-1-iter2.md`. |

