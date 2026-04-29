# Sprint 5 — Dispatch Plan (10 agentes × 2 iter)

**Goal**: cierre Sprint 5 — multi-tenant FE portal premium + features finales (SAML/SCIM/GuardDuty) + UAT/Go-Live prep + Design System (Lordicons + GSAP).

**Periodo**: Sprint 5 days 26-30 según `MVP_02` (UAT MAC + DR drill + Code Freeze + Go-Live día 30).

**Pedido explícito del cliente** (Tech Lead, 2026-04-28):
1. **Multi-tenant gestionable desde admin** — el admin debe poder configurar branding (logo, colores, nombre comercial) por tenant; el portal del asegurado debe consumirlo dinámicamente.
2. **UI/UX de alto valor — no genérica** — todo cambio debe usar:
   - **Lordicons animados** (`@lordicon/react` o `lord-icon-element` web component)
   - **GSAP** para transiciones, micro-interacciones, page transitions, scroll triggers
3. **Reto de cierre**: tests existentes no se pueden romper. 1222/1222 verde post-Sprint 4 es el baseline.

**Calidad obligatoria** (ver `docs/fixes/DEVELOPER_GUIDE.md` 1130 líneas — lectura obligatoria pre-PR):
- TDD: tests primero, suite scoped pasa antes de marcar DONE.
- Coverage thresholds 60/55/60/60 (security-critical 80/75).
- AuditContextFactory.fromRequest(req) en todo audit log.
- @Throttle en endpoints públicos.
- DTOs Zod + @ApiProperty Swagger.
- RLS en cada tabla nueva (migración + policies.sql array + cross-tenant test).
- Cookie/CSRF: importar desde `@segurasist/security`.
- Idempotencia DB-side con UNIQUE constraints (SQS standard NO acepta dedupeId).
- Audit timeline events con ctx HTTP (ip, ua, traceId).
- **NUEVO Sprint 5**: Branding assets en S3 con CloudFront caché 1h max-age, Sub-Resource Integrity opcional para CSS dinámico, CSP `img-src` permite tenant CDN.
- **NUEVO Sprint 5**: GSAP/Lordicons solo desde `@segurasist/ui` (no instalar en apps directamente — DRY).

## Asignación de bundles (10 agentes paralelos)

| Agent | Rol | Bundle / Historias | Pts |
|---|---|---|---|
| **MT-1** | Backend Senior Multi-Tenant | Tenant branding model + endpoints `/v1/tenants/me/branding` (insured) y `/v1/admin/tenants/:id/branding` (admin CRUD) + S3 logo upload | 8 |
| **MT-2** | Frontend Senior Admin Branding | Admin UI editor: logo dropzone, color pickers (primary/accent/bg), tipografía, live preview, validación, Lordicons + GSAP | 8 |
| **MT-3** | Frontend Senior Portal Multi-Tenant | TenantContextProvider + dynamic CSS vars + branded header/sidebar/footer, fallback graceful, GSAP page transitions, Lordicons en nav | 8 |
| **MT-4** | QA Multi-Tenant + Visual | E2E cross-tenant cross-leak (login A → no datos B), visual regression (Playwright snapshot), test branding update propagation | 5 |
| **S5-1** | Backend Senior Identity (SAML/SCIM) | SAML SSO admin (SP-init) + SCIM 2.0 user/group provisioning (admin tenants) + ADR-0009 federation strategy | 13 |
| **S5-2** | DevOps Security | GuardDuty + Security Hub Terraform módulos, alarmas Slack, runbooks, ADR-0010 GuardDuty findings triage | 5 |
| **S5-3** | Full-stack Chatbot extensions | Admin KB editor CRUD UI + portal "Mis conversaciones" histórico 30d (retención + UI con Lordicons + animations GSAP) | 8 |
| **G-1** | DevOps DR Drill | Ejecutar DR drill (RDS PITR + S3 versioning restore) staging, runbook RB-018, ADR-0011 RTO/RPO validados | 5 |
| **G-2** | QA Performance + DAST | Re-correr ZAP contra Swagger expuesto + perf baseline real `perf.yml` staging + reporte | 5 |
| **DS-1** | Design System Lead | `@segurasist/ui` añade Lordicons wrapper + GSAP primitives (`<GsapFade>`, `<GsapStagger>`, `<PageTransition>`, hover micro-interactions). Aplicar nav admin/portal. ADR-0012 motion design + ADR-0013 brandable theming. UAT script + Go-Live checklist | 13 |

**Total**: 78 pts.

## File Ownership Map (estricto — NO cruzar)

### Backend API

| Path | Owner |
|---|---|
| `src/modules/tenants/branding/**` (NUEVO) | **MT-1** |
| `src/modules/tenants/branding/branding.service.ts` | **MT-1** |
| `src/modules/tenants/branding/branding.controller.ts` (insured GET) | **MT-1** |
| `src/modules/admin/tenants/branding-admin.controller.ts` (NUEVO) | **MT-1** |
| `src/modules/admin/tenants/branding-upload.service.ts` (S3 upload) | **MT-1** |
| `prisma/schema.prisma` (Tenant.brandingLogoUrl, brandingPrimary, brandingAccent, brandingBgImageUrl, brandingTagline, displayName) | **MT-1** |
| `prisma/migrations/20260429_tenant_branding/**` | **MT-1** |
| `src/modules/auth/saml/**` (NUEVO) | **S5-1** |
| `src/modules/auth/saml/saml.controller.ts` (`/v1/auth/saml/login`, `/saml/acs`, `/saml/metadata`) | **S5-1** |
| `src/modules/auth/saml/saml.service.ts` | **S5-1** |
| `src/modules/scim/**` (NUEVO) | **S5-1** |
| `src/modules/scim/scim.controller.ts` (`/v1/scim/v2/Users`, `/Groups`) | **S5-1** |
| `src/modules/chatbot/kb-admin/**` (NUEVO admin CRUD) | **S5-3** |
| `src/modules/chatbot/conversations-history/**` (retención + query) | **S5-3** |
| `src/modules/chatbot/cron/conversations-retention.service.ts` (NUEVO — purge >30d) | **S5-3** |
| `prisma/schema.prisma` (KbEntry editable + ChatConversation.expiresAt) | **S5-3** |

### Frontend admin

| Path | Owner |
|---|---|
| `apps/admin/app/(app)/settings/branding/**` (NUEVO) | **MT-2** |
| `apps/admin/components/branding-editor/**` (NUEVO) | **MT-2** |
| `apps/admin/components/branding-editor/logo-dropzone.tsx` | **MT-2** |
| `apps/admin/components/branding-editor/color-picker-card.tsx` | **MT-2** |
| `apps/admin/components/branding-editor/preview-pane.tsx` (live preview portal mock) | **MT-2** |
| `apps/admin/app/(app)/identity/saml/**` (admin SAML config UI) | **S5-1** |
| `apps/admin/app/(app)/chatbot/kb/**` (NUEVO KB editor) | **S5-3** |

### Frontend portal

| Path | Owner |
|---|---|
| `apps/portal/components/tenant/tenant-context.tsx` (NUEVO React Context) | **MT-3** |
| `apps/portal/components/tenant/tenant-provider.tsx` (NUEVO — bootstrap branding desde /v1/tenants/me/branding) | **MT-3** |
| `apps/portal/components/layout/branded-header.tsx` (NUEVO o adaptación) | **MT-3** |
| `apps/portal/components/layout/branded-footer.tsx` | **MT-3** |
| `apps/portal/components/layout/branded-sidebar.tsx` | **MT-3** |
| `apps/portal/lib/hooks/use-tenant-branding.ts` (NUEVO) | **MT-3** |
| `apps/portal/app/(app)/chatbot/history/**` (NUEVO histórico) | **S5-3** |

### Packages compartidos

| Path | Owner |
|---|---|
| `packages/ui/src/lord-icon/**` (NUEVO `<LordIcon>` wrapper SSR-safe) | **DS-1** |
| `packages/ui/src/animations/**` (NUEVO GSAP primitives) | **DS-1** |
| `packages/ui/src/animations/gsap-fade.tsx` | **DS-1** |
| `packages/ui/src/animations/gsap-stagger.tsx` | **DS-1** |
| `packages/ui/src/animations/page-transition.tsx` | **DS-1** |
| `packages/ui/src/animations/use-gsap.ts` (hook isomórfico) | **DS-1** |
| `packages/ui/src/theme/brandable-tokens.ts` (NUEVO — tokens dinámicos por tenant) | **DS-1** + **MT-3** (consumer) |
| `packages/ui/package.json` (deps: `@lordicon/react`, `gsap`, `lord-icon-element`) | **DS-1** |
| `packages/security/src/csp.ts` (extender img-src/connect-src para tenant CDN) | **MT-1** + **MT-3** consumer |

### Infraestructura

| Path | Owner |
|---|---|
| `segurasist-infra/modules/guardduty/**` (NUEVO) | **S5-2** |
| `segurasist-infra/modules/security-hub/**` (NUEVO) | **S5-2** |
| `segurasist-infra/modules/s3-tenant-branding/**` (NUEVO bucket + CloudFront) | **MT-1** |
| `scripts/dr-drill/**` (NUEVO scripts ejecución) | **G-1** |

### Tests

| Path | Owner |
|---|---|
| `tests/e2e/multi-tenant-portal.spec.ts` (NUEVO cross-leak) | **MT-4** |
| `tests/e2e/admin-branding-roundtrip.spec.ts` (NUEVO admin → portal propagation) | **MT-4** |
| `tests/visual-regression/portal-tenant-a.spec.ts` (NUEVO) | **MT-4** |
| `segurasist-api/test/unit/modules/tenants/branding.service.spec.ts` | **MT-1** |
| `segurasist-api/test/integration/branding.controller.spec.ts` | **MT-1** |
| `segurasist-api/test/unit/modules/auth/saml/saml.service.spec.ts` | **S5-1** |
| `segurasist-api/test/integration/scim.controller.spec.ts` | **S5-1** |
| `segurasist-web/apps/admin/test/integration/branding-editor.spec.tsx` | **MT-2** |
| `segurasist-web/apps/portal/test/integration/tenant-provider.spec.tsx` | **MT-3** |
| `segurasist-web/packages/ui/test/animations/**` | **DS-1** |
| `tests/performance/k6/sprint5-baseline.js` (NUEVO) | **G-2** |
| `tests/dast/sprint5-zap-config.yaml` | **G-2** |

### Docs

| Path | Owner |
|---|---|
| `docs/runbooks/RB-018-dr-drill.md` | **G-1** |
| `docs/runbooks/RB-019-saml-onboarding.md` | **S5-1** |
| `docs/runbooks/RB-020-guardduty-triage.md` | **S5-2** |
| `docs/runbooks/RB-021-tenant-branding-onboarding.md` | **MT-1** + **MT-2** |
| `docs/adr/ADR-0009-saml-sso-strategy.md` | **S5-1** |
| `docs/adr/ADR-0010-guardduty-findings-triage.md` | **S5-2** |
| `docs/adr/ADR-0011-rto-rpo-validated.md` | **G-1** |
| `docs/adr/ADR-0012-motion-design-gsap.md` | **DS-1** |
| `docs/adr/ADR-0013-brandable-theming.md` | **DS-1** + **MT-1** |
| `docs/qa/SPRINT5_DOR_DOD.md` | **MT-4** + **DS-1** (final consolidación) |
| `docs/qa/UAT_SCRIPT.md` | **DS-1** |
| `docs/qa/CODE_FREEZE_CHECKLIST.md` | **DS-1** |

## Coordinación entre agentes

### Contratos a publicar en iter 1 (consumibles en iter 2)

| Quién publica | Qué | Quién consume |
|---|---|---|
| **MT-1** | Shape de `GET /v1/tenants/me/branding` (insured): `{ tenantId, displayName, tagline, logoUrl, primaryHex, accentHex, bgImageUrl, lastUpdatedAt }` | **MT-2**, **MT-3** |
| **MT-1** | Shape de `PUT /v1/admin/tenants/:id/branding` (admin) + `POST /v1/admin/tenants/:id/branding/logo` (multipart) | **MT-2** |
| **DS-1** | API de `<LordIcon name="..." trigger="hover" colors={{primary:""}} />` | **MT-2**, **MT-3**, **S5-3** |
| **DS-1** | API de `<GsapFade>`, `<GsapStagger>`, `<PageTransition>` | **MT-2**, **MT-3**, **S5-3** |
| **DS-1** | API de `applyBrandableTheme({primaryHex, accentHex, bgImageUrl})` | **MT-3** |
| **S5-1** | Shape SAML metadata + SCIM endpoints | **S5-1** UI consumer |

### Reglas duras

1. **Tests existentes 1222/1222 NO se pueden romper**. Si tu cambio rompe tests del paquete `chatbot`/`reports`/`audit-timeline` ya verdes, ARREGLA en iter 2 — no lo dejes a "validation gate".
2. **Cero deps duplicadas**: `gsap` y `@lordicon/react` van solo en `packages/ui` — apps lo consumen vía re-export.
3. **CSS vars dinámicas**: el portal NO puede usar inline-styles para branding (CSP). Usar `<style nonce={...}>:root { --tenant-primary: ... }</style>` o data attributes.
4. **Logo upload**: PNG/SVG/WebP, max 512KB, dims max 1024x1024, file-magic-bytes validation (ya tienen util `src/common/utils/file-magic-bytes.ts`).
5. **Tenant context en portal**: el JWT YA tiene `custom:tenant_id`. El branding lo carga el provider via `/v1/tenants/me/branding` con SWR y cache 5min.
6. **Hex validation**: backend valida con regex `^#[0-9a-fA-F]{6}$`. FE valida lo mismo + warning de contraste WCAG AA si hex contra fondo no pasa.
7. **GSAP en SSR**: usar `useEffect` o `dynamic(() => ..., { ssr: false })` — gsap NO es SSR-safe, romperá hydration.
8. **Lordicons SSR**: `lord-icon-element` es web component → solo client-side. Usar `'use client'` y `next/dynamic`.

### Feed compartido

- **Master feed**: `docs/sprint5/_features-feed.md` (read-only para agentes; orchestrator consolida).
- **Per-agent feeds**: `docs/sprint5/feed/<id>-iter<N>.md` (cada agente escribe el suyo).
- Cada bloque feed: `## [<id> iter <N>] <fecha>` + secciones `Plan`, `Hechos`, `NEW-FINDING`, `Bloqueos`, `Para iter 2 / cross-cutting`.

## Validation gate D5 (post iter 2)

1. `pnpm -w typecheck` clean
2. `pnpm -w lint` clean
3. `pnpm --filter segurasist-api test --run` 100% pass + coverage thresholds
4. `pnpm --filter @segurasist/* test --run` 100% pass
5. `pnpm --filter admin test --run` + `pnpm --filter portal test --run` 100% pass
6. `pnpm --filter admin build` + `pnpm --filter portal build` (Next prod build)
7. E2E Chrome scope multi-tenant: `tests/e2e/multi-tenant-portal.spec.ts` + `tests/e2e/admin-branding-roundtrip.spec.ts` ✅
8. Visual regression baseline (Playwright snapshot reference checked in)
9. Perf baseline `tests/performance/k6/sprint5-baseline.js` p95 dentro umbrales
10. ZAP DAST report 0 High, 0 Medium en endpoints públicos
11. Coverage diff vs Sprint 4: `docs/sprint5/COVERAGE_DIFF.md` mostrando deltas por módulo

## Definition of Done (Sprint 5)

- [ ] 78 pts entregados (10 historias × promedio 7.8)
- [ ] 5 ADRs nuevos (ADR-0009..ADR-0013)
- [ ] 4 runbooks nuevos (RB-018..RB-021)
- [ ] DEVELOPER_GUIDE.md actualizado con anti-patterns Sprint 5 (mín 5 nuevos)
- [ ] Multi-tenant portal: 1 tenant default + 2 tenants demo (MAC + DEMO_INSURER) seedeados
- [ ] Admin puede editar branding y ver preview en <200ms
- [ ] Portal cambia branding con reload (NO live; aceptable para Go-Live)
- [ ] DAST limpio + perf baseline checked-in
- [ ] DR drill ejecutado y RTO/RPO validados (RTO ≤ 4h, RPO ≤ 15min)
- [ ] UAT script firmado por MAC stakeholders (placeholder OK — el commit lo deja listo)
- [ ] Code freeze checklist marcado completo
