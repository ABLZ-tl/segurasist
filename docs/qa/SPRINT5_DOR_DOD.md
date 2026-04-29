# Sprint 5 — DoR / DoD Validation Matrix (placeholder)

> **Owners**: MT-4 (QA Multi-Tenant) — borrador inicial; **DS-1** (Design System Lead) consolida la versión final post iter 2.
> **Audiencia**: PO (Alan), Tech Lead, agentes MT-1..MT-4, S5-1..3, G-1, G-2, DS-1.
> **Fuente DoR/DoD canónica**: `MVP_02_Plan_Proyecto_SegurAsist` §9.1, §9.2, §9.3.
> **Fuente criterios aceptación Sprint 5**: `docs/sprint5/DISPATCH_PLAN.md` §"Validation gate D5" + §"Definition of Done (Sprint 5)".
> **Estado iter 1 (placeholder MT-4)**: Estructura + DoR completos + DoD por agente skeletoneado. Cierre real con sello DS-1 al final del Sprint.

---

## Leyenda

| Símbolo | Significado |
|---|---|
| ✅ | Criterio cumplido (con evidencia documental o de tests). |
| 🟡 | En curso (parcial al cierre iter 1; cierre esperado iter 2). |
| ❌ | No cumplido (acción correctiva requerida). |
| N/A | No aplica. |
| ❔ | A validar manualmente al cierre del Sprint (DAST nightly, DR drill, UAT MAC). |
| ⏳ | Pendiente — placeholder iter 1. |

---

## 1. Definition of Ready (DoR) — gating de entrada al Sprint 5

DoR canónico (`MVP_02` §9.1):

1. Historia escrita en formato "Como… quiero… para…".
2. Criterios de aceptación enumerados (Given/When/Then).
3. Mockup o esbozo si afecta UI.
4. Estimada en puntos por el equipo.
5. Dependencias resueltas o explícitamente identificadas.

### 1.1 Gating de entrada (pre-Sprint 5)

| Criterio | Evidencia | Estado |
|---|---|---|
| Sprint 4 cerrado 1222/1222 verde | `docs/sprint5/DISPATCH_PLAN.md` §Goal "Reto de cierre" | ✅ |
| `DISPATCH_PLAN.md` publicado con File Ownership | `docs/sprint5/DISPATCH_PLAN.md` | ✅ |
| Contratos backend ↔ frontend acordados | `DISPATCH_PLAN.md` §"Contratos a publicar en iter 1" (5 contratos: branding GET/PUT/POST, Lordicons API, GSAP API, brandable theme) | ✅ |
| Credenciales 5 roles dev local documentadas | `external/access/test.md` (commit `87da1cf`) | ✅ |
| Schema branding ya migrada | `prisma/schema.prisma` modelo `Tenant` campos `displayName`, `tagline`, `brandingPrimaryHex`, `brandingAccentHex`, `brandingLogoUrl`, `brandingBgImageUrl`, `brandingUpdatedAt` | ✅ |
| Seeds multi-tenant disponibles | `segurasist-api/prisma/seed-multi-tenant.ts` (MT-4 entrega iter 1) | ✅ |
| Stack staging up + LOCAL_DEV reproducible | `docs/LOCAL_DEV.md` + `scripts/local-up.sh` | ✅ |
| Playwright + Vitest infra E2E lista | `segurasist-web/tests/e2e/` (Sprint 1) + `tests/e2e/playwright.config.ts` (Sprint 5) | ✅ |
| Coverage thresholds heredados de Sprint 4 (60/55/60/60; security 80/75) | `docs/fixes/DEVELOPER_GUIDE.md` | ✅ |
| Feed compartido + per-agent feed activo | `docs/sprint5/_features-feed.md` + `docs/sprint5/feed/` | ✅ |

### 1.2 DoR por bundle (10 historias)

| Bundle | "Como/quiero/para" | Acceptance criteria | Mockup | Pts | Deps | Estado |
|---|---|---|---|---|---|---|
| **MT-1** Branding endpoints | Como admin, quiero CRUD del branding de mi tenant para personalizar la experiencia del asegurado | Given admin auth → PUT actualiza fila → GET refleja cambio | DS-1 entrega Figma del editor | 8 | RLS + S3 bucket | ✅ |
| **MT-2** Admin UI editor | Como admin, quiero un editor visual con preview live para iterar sin redeploy | Color pickers + dropzone + Save → 200 → toast | Figma DS-1 | 8 | MT-1 endpoints | ✅ |
| **MT-3** Portal multi-tenant | Como asegurado, quiero ver mi aseguradora con su identidad para reconocerla | TenantContext + CSS vars + branded layout + GSAP transitions | DS-1 motion specs | 8 | MT-1 GET branding | ✅ |
| **MT-4** QA multi-tenant | Como QA, quiero E2E cross-tenant + visual regression para asegurar zero leak | Specs verde + snapshots commit | N/A | 5 | MT-1 + MT-3 | ✅ |
| **S5-1** SAML/SCIM | Como cliente enterprise, quiero SSO + provisioning para integrar mi IdP | SAML metadata + ACS + SCIM Users/Groups CRUD | mockup admin SAML config | 13 | Identity contracts | ✅ |
| **S5-2** GuardDuty + SecHub | Como seguridad, quiero findings centralizados para triage proactivo | TF módulos + alarmas Slack + runbook RB-020 | N/A | 5 | AWS account | ✅ |
| **S5-3** Chatbot extensions | Como admin/asegurado, quiero KB editable + histórico 30d | Admin CRUD + portal "Mis conversaciones" + retención | Figma DS-1 | 8 | KB schema | ✅ |
| **G-1** DR drill | Como SRE, quiero ejecutar PITR + S3 restore en staging | RTO ≤4h, RPO ≤15min validados | N/A | 5 | Staging snapshot | ✅ |
| **G-2** Perf + DAST | Como QA, quiero baseline real + ZAP limpio | k6 p95 dentro umbrales + 0 High/Med | N/A | 5 | Staging up | ✅ |
| **DS-1** Design system | Como DS lead, quiero Lordicons + GSAP centralizados + UAT script | `@segurasist/ui` re-exports + ADRs 0012/0013 | Figma motion | 13 | N/A | ✅ |

**Totales DoR**: 10/10 historias listas — **gate ✅** (al cierre iter 1).

---

## 2. Definition of Done (DoD) — cierre del Sprint 5

DoD canónico (`MVP_02` §9.2):

1. Tests automatizados pasando (suite + scoped).
2. Coverage thresholds respetados (no regression).
3. PR aprobado por mínimo 1 reviewer + CI verde.
4. Documentación actualizada (READMEs / ADRs / runbooks).
5. Smoke en staging verde.
6. Cross-tenant gate verde.
7. DAST/SAST sin findings High.

### 2.1 Validation gate D5 (post iter 2) — global

(Copiado del `DISPATCH_PLAN.md` §"Validation gate D5"; MT-4 confirma cada item al cierre.)

| # | Gate | Evidencia esperada | Estado |
|---|---|---|---|
| 1 | `pnpm -w typecheck` clean | log CI + screenshot | ⏳ |
| 2 | `pnpm -w lint` clean | log CI | ⏳ |
| 3 | API tests 100% + coverage thresholds | `pnpm --filter segurasist-api test --run` + `coverage/lcov-report` | ⏳ |
| 4 | Packages tests 100% | `pnpm --filter @segurasist/* test --run` | ⏳ |
| 5 | Admin + portal Vitest 100% | `pnpm --filter admin test --run` + `pnpm --filter portal test --run` | ⏳ |
| 6 | Next prod build OK | `pnpm --filter admin build` + `pnpm --filter portal build` | ⏳ |
| 7 | E2E Sprint 5 verde | `tests/e2e/multi-tenant-portal.spec.ts` + `admin-branding-roundtrip.spec.ts` (HTML report en `tests/e2e/reports/sprint5-<ts>/`) | ⏳ |
| 8 | Visual regression baseline checked-in | `tests/visual-regression/__screenshots__/portal-tenant-{a,b}-dashboard.png` | ⏳ |
| 9 | Perf baseline `tests/performance/k6/sprint5-baseline.js` p95 dentro umbrales | reporte k6 cloud + `docs/sprint5/PERF_REPORT.md` | ⏳ |
| 10 | ZAP DAST 0 High/Medium | `tests/dast/sprint5-zap-config.yaml` + reporte HTML en `docs/sprint5/zap-report-<ts>.html` | ⏳ |
| 11 | Coverage diff vs Sprint 4 documentado | `docs/sprint5/COVERAGE_DIFF.md` | ⏳ |

### 2.2 DoD por agente

#### MT-1 (Backend Branding)
- [ ] Branding endpoints GET/PUT/POST entregados con DTOs Zod + Swagger
- [ ] RLS policies en `tenants` actualizadas para columnas branding (cross-tenant test verde)
- [ ] AuditContextFactory en cada update + email events si aplica
- [ ] `branding.service.ts` + `branding-admin.controller.ts` 80% coverage
- [ ] S3 bucket TF + CloudFront + CSP `img-src` actualizado
- [ ] ADR-0013 (brandable theming) firmado
- [ ] Runbook RB-021 publicado

#### MT-2 (Admin Branding UI)
- [ ] Editor MT-2 entregado con dropzone + color pickers + preview
- [ ] Validación hex `^#[0-9a-fA-F]{6}$` + WCAG AA contraste warning
- [ ] Lordicons + GSAP integrados desde `@segurasist/ui` (cero deps duplicadas)
- [ ] Vitest integration spec `branding-editor.spec.tsx` 60% coverage
- [ ] Save → toast + invalidación SWR en preview pane

#### MT-3 (Portal Multi-Tenant)
- [ ] TenantBrandingProvider bootstrap desde `/v1/tenants/me/branding`
- [ ] Branded header/sidebar/footer aplicando CSS vars
- [ ] Logout purga TenantContext (no bleed entre sesiones)
- [ ] GSAP page transitions + Lordicons en nav
- [ ] Vitest `tenant-provider.spec.tsx` ≥60% coverage

#### MT-4 (QA Multi-Tenant — este agente)
- [x] E2E `multi-tenant-portal.spec.ts` con 5+ assertions (iter 1 .skip, iter 2 unskip)
- [x] E2E `admin-branding-roundtrip.spec.ts` con cleanup
- [x] Visual regression `portal-tenant-a.spec.ts` baseline
- [x] Vitest `cross-tenant.spec.tsx` (sanity)
- [x] Seed multi-tenant idempotente
- [x] Run script `multi-tenant-portal.run.sh` con report timestamped
- [x] DoR/DoD placeholder (este doc)
- [ ] **iter 2**: unskip + commit baselines + report HTML linked

#### S5-1 (SAML/SCIM)
- [ ] SAML SP-init flow + ACS + metadata endpoint
- [ ] SCIM 2.0 Users + Groups CRUD
- [ ] ADR-0009 federation strategy
- [ ] Runbook RB-019 SAML onboarding

#### S5-2 (GuardDuty)
- [ ] TF módulos `guardduty/` + `security-hub/`
- [ ] Alarmas Slack
- [ ] ADR-0010 + Runbook RB-020

#### S5-3 (Chatbot ext)
- [ ] KB editor admin CRUD
- [ ] Portal histórico 30d con cron retention
- [ ] Tests integration ≥60%

#### G-1 (DR drill)
- [ ] PITR + S3 versioning restore staging
- [ ] RTO/RPO medidos
- [ ] ADR-0011 + Runbook RB-018

#### G-2 (Perf + DAST)
- [ ] k6 baseline p95 OK
- [ ] ZAP limpio (0 H/M)

#### DS-1 (Design System)
- [ ] `<LordIcon>` SSR-safe wrapper
- [ ] GSAP primitives (Fade/Stagger/PageTransition)
- [ ] `applyBrandableTheme` API
- [ ] ADR-0012 (motion design)
- [ ] UAT script + Code freeze checklist
- [ ] DoR/DoD final consolidado (este doc — sello final)

---

## 3. Open items para iter 2 (consolida DS-1)

1. Quitar `it.skip` de los 3 specs Sprint 5 una vez MT-1/MT-3 entreguen iter 1.
2. Commit baselines visual regression `__screenshots__/`.
3. Anti-patterns Sprint 5 a documentar en `docs/fixes/DEVELOPER_GUIDE.md` (mín 5 nuevos por DISPATCH_PLAN §DoD).
4. Coverage diff Sprint 4 vs Sprint 5 (`docs/sprint5/COVERAGE_DIFF.md`).
5. UAT script con stakeholders MAC firmando (placeholder OK al commit final).

---

## 4. Cambios desde Sprint 4

- Nuevos thresholds NO requeridos (heredamos 60/55/60/60 + security 80/75).
- Nuevo gate: visual regression baseline (Playwright snapshot, MT-4).
- Nuevo gate: DR drill RTO/RPO validados (G-1).
- Nuevo gate: branding endpoints con cross-tenant test obligatorio (MT-1).
