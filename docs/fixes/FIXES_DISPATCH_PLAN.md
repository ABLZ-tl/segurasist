# Fixes Dispatch Plan — 10 agentes × 2 iteraciones

## File Ownership Map (estricto)

> Solo el agente listado puede modificar. Excepciones documentadas en notas.

### Backend API (`segurasist-api/`)

| Path | Owner |
|---|---|
| `src/workers/pdf-worker.service.ts` | **F1** |
| `src/modules/certificates/certificates.service.ts` | **F1** iter 1 → F6 puede agregar audit ctx en iter 2 |
| `src/modules/certificates/dto/**` | **F1** |
| `src/modules/auth/auth.service.ts` | **F2** (cognito_sub persist) → F6 audit ctx iter 2 |
| `src/infra/aws/cognito.service.ts` | **F2** |
| `src/config/env.schema.ts` | **F3** (consolidador único de TODA modificación env) |
| `src/modules/auth/auth.controller.ts` | **F3** (refresh throttle) |
| `prisma/rls/policies.sql` | **F3** |
| `scripts/apply-rls.sh` | **F3** |
| `src/infra/aws/ses.service.ts` | **F3** |
| `src/workers/email-worker.service.ts` | **F3** |
| `.env.example` | **F3** (consolida todo) |
| `src/modules/batches/batches.service.ts` | **F4** |
| `src/workers/layout-worker.service.ts` | **F4** |
| `src/workers/insureds-creation-worker.service.ts` | **F4** |
| `prisma/schema.prisma` (sección `Batch` + nuevas cols) | **F4** |
| `prisma/schema.prisma` (enum `AuditAction`) | **F6** |
| `prisma/migrations/20260428_batch_progress_columns/` | **F4** |
| `prisma/migrations/20260428_insureds_creation_unique/` | **F5** |
| `prisma/migrations/20260428_audit_action_enum_extend/` | **F6** |
| `src/infra/aws/sqs.service.ts` | **F5** |
| `src/modules/webhooks/ses-webhook.controller.ts` | **F5** |
| `segurasist-api/package.json` | **F5** (dueño único; F8 declara `@nestjs/swagger` + `zod-to-openapi` en feed) |
| `scripts/localstack-bootstrap.sh` | **F5** |
| `src/modules/audit/**` | **F6** |
| `src/common/interceptors/audit.interceptor.ts` | **F6** |
| `src/common/utils/scrub-sensitive.ts` | **F6** |
| `src/modules/claims/claims.controller.ts` | **F6** (audit ctx) |
| `src/main.ts` | **F8** (Swagger setup) |
| `jest.config.ts` | **F9** |
| `test/security/cross-tenant.spec.ts` | **F9** |
| `test/integration/bypass-rls-defense.spec.ts` | **F9** (nuevo) |
| `test/e2e/setup.ts` | **F9** |
| `test/integration/cert-integrity.spec.ts` | **F1** (nuevo) |
| `test/integration/otp-flow.spec.ts` | **F2** (nuevo) |
| `test/integration/batches-flow.spec.ts` | **F4** |
| `test/integration/batch-completed-once.spec.ts` | **F4** (nuevo) |
| `test/integration/audit-tampering.spec.ts` | **F6** (nuevo) |
| `test/integration/sqs-dedup-removal.spec.ts` | **F5** (nuevo) |
| `test/integration/ses-webhook-security.spec.ts` | **F5** (nuevo) |
| `test/integration/apply-rls-idempotency.spec.ts` | **F3** (nuevo) |
| `test/unit/config/env.schema.spec.ts` | **F3** |
| `test/unit/infra/ses-adapter.spec.ts` | **F3** |
| `src/modules/insureds/where-builder.ts` | **F10** (nuevo, shared `buildInsuredsWhere`) |
| `src/modules/insureds/insureds.service.ts` | **F10** iter 1 (where-builder) → F6 iter 2 (audit ctx) |
| `src/modules/exports/exports.service.ts` | **F10** (where-builder) |
| `src/workers/reports-worker.service.ts` | **F10** (where-builder) |
| `scripts/cognito-local-bootstrap.sh` | **F10** (given_name claim H-27) |

### Frontend Web (`segurasist-web/`)

| Path | Owner |
|---|---|
| `apps/portal/app/api/proxy/[...path]/route.ts` | **F2** (C-02 cookie + H-04 origin) |
| `apps/portal/next.config.mjs` | **F2** (CSP frame-src) |
| `apps/admin/next.config.mjs` | **F2** (CSP preventiva) |
| `apps/portal/test/integration/csp-iframe.spec.ts` | **F2** (nuevo) |
| `packages/security/**` | **F7** (paquete NUEVO completo) |
| `packages/auth/src/session.ts` | **F7** (refactor → strict) |
| `packages/auth/src/middleware.ts` | **F7** (usar packages/security) |
| `packages/auth/vitest.config.ts` | **F9** (threshold) — coordinar con F7 si toca otros archivos |
| `apps/admin/lib/cookie-config.ts` | **F7** (re-export) |
| `apps/admin/lib/origin-allowlist.ts` | **F7** |
| `apps/portal/lib/cookie-config.ts` | **F7** |
| `apps/portal/lib/origin-allowlist.ts` | **F7** |
| `apps/admin/app/api/auth/[...nextauth]/route.ts` | **F7** (logout POST + Origin) |
| `apps/admin/vitest.config.ts` | **F9** |
| `apps/portal/vitest.config.ts` | **F9** |
| `packages/{ui,api-client}/vitest.config.ts` | **F9** |
| `apps/portal/lighthouserc.js` | **F9** |
| `apps/portal/components/mobile-drawer.tsx` | **F10** (H-25 tenant switcher) |
| `apps/portal/test/integration/insured-flow.spec.ts` | **F9** (nuevo, H-23) |
| `packages/api-client/test/**` | **F9** (nuevos, H-28) |

### Infra (`segurasist-infra/`)

| Path | Owner |
|---|---|
| `modules/sqs-queue/**` | **F5** |
| `envs/{dev,staging,prod}/main.tf` (SQS pieces) | **F5** |
| `envs/{dev,staging,prod}/alarms.tf` (NUEVO) | **F8** |
| `modules/cloudwatch-alarm/**` | **F8** |
| `global/iam-github-oidc/main.tf` | **F8** |
| `docs/runbooks/RB-{001,002,004,005,007,013}.md` | **F8** |
| `docs/runbooks/RB-{009,010,011,012}.md` (otros TBD) | **F10** |

### Repo root

| Path | Owner |
|---|---|
| `.github/workflows/ci.yml` | **F8** (Trivy job) |
| `docs/fixes/_fixes-feed.md` | TODOS (append-only) |
| `docs/fixes/DEVELOPER_GUIDE.md` | **F10** (consolidador, completa al final iter 2) |
| `docs/fixes/F<N>-report.md` | cada F<N> (uno por agente) |
| `docs/fixes/FIXES_REPORT.md` | F0 (orquestador, post-iter2 + E2E) |

## Reglas absolutas

1. **NO** modificar archivos fuera de tu ownership.
2. **NO** commit/push (orquestador centraliza).
3. **NO** correr `docker`, `npm install`, deploys (solo lectura + edits + correr tests existentes).
4. **SI** correr `pnpm test`, `pnpm test:unit`, `npx vitest run --coverage` solo de TU módulo.
5. **SI** append al feed:
   - Al iniciar iter 1 (`STARTED`)
   - Por cada Critical/High cerrado (`DONE`)
   - Por cualquier `NEW-FINDING` cross-cutting
   - Al cerrar iter 1 con `iter1-complete`
   - Idem iter 2
6. **Tests existentes NO se rompen** — si tu fix rompe tests previos, investigar antes de marcar `DONE`.
7. **Tests nuevos de tu bundle** son obligatorios (ver INDEX sección 8).
8. **Iter 2** obligatoria: re-leer feed completo + integrar follow-ups + correr suite completa de TU módulo.

## Output esperado por agente

`docs/fixes/F<N>-report.md`:

```markdown
# Fix Report — F<N> <bundle-name>

## Iter 1 (resumen)
- Issues cerrados: C-XX, H-YY (con file:line + commit-hash si aplica)
- Tests añadidos: <count> (paths)
- Tests existentes corridos: ✅ N pass / ❌ M fail
- Cross-cutting findings: (referencias al feed)

## Iter 2 (resumen)
- Follow-ups del feed que apliqué: ...
- Coordinaciones con otros agentes: ...
- Tests post-iter2: ✅ N pass / ❌ M fail

## Compliance impact
- Controles V2 movidos a 100%: ...

## Lecciones para DEVELOPER_GUIDE.md
- (3-5 bullets para que F10 los integre en la guía final)
```
