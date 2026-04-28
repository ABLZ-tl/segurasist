# F10 — feed entries iter 2 (CONSOLIDADOR DEVELOPER_GUIDE)

> Bundle: consolidación final del `docs/fixes/DEVELOPER_GUIDE.md` post-iter 1.
> Append-only. F0 orquestador integra estas entradas a `docs/fixes/_fixes-feed.md`.

```
[F10] 2026-04-28 06:00 iter2 STARTED — DEVELOPER_GUIDE consolidation. Re-leídos los 10 F<N>-report.md de iter 1 + entradas iter 2 ya cerradas en feed (F1, F2, F3, F4) para extraer evidencia file:line, fixes aplicados, reglas preventivas y lecciones por bundle.

[F10] 2026-04-28 06:20 iter2 DONE secciones 1.1 a 1.7 — patterns documentados con evidencia Sprint 3 + fix Sprint 4 + regla preventiva + lección Sprint 4+. Cada anti-pattern lleva 4 bullets accionables y una lección sintética. Consistencia revisada con secciones 1.8-1.11 que ya estaban en iter 1.

[F10] 2026-04-28 06:30 iter2 DONE seccion 2 cheat-sheet — refinada con ejemplos de código (≤6 líneas cada uno) en los 5 sub-bloques (endpoint, worker SQS, tabla RLS, route FE, audit action). Imports concretos, snippets copy-paste-ready.

[F10] 2026-04-28 06:35 iter2 DONE seccion 3 setup local-dev — agregado: (1) `pnpm install` post-merge limpio (multi-agent dejó node_modules + lockfile dirty por F7 symlinks y F9 devDeps api-client); (2) `rm -rf apps/portal/.next apps/admin/.next` post-merge tras toques a `lib/cookie-names.ts` o `packages/security/` (F2 NEW-FINDING #2); (3) suite completa post-fixes en bloque copy-paste.

[F10] 2026-04-28 06:40 iter2 DONE seccion 4 CI/CD gates — refinada con thresholds reales aplicados por F9: BE/portal/admin/ui/api-client 60/55/60/60; packages/auth + packages/security 80/75/80/80 (security-critical). Lighthouse port corregido a portal :3002 (F9 H-22). Trivy con `ignore-unfixed` + severity HIGH/CRITICAL (F8). ZAP DAST desbloqueado vía Swagger Bearer (F8 C-12).

[F10] 2026-04-28 06:50 iter2 DONE seccion 5 PR checklist — completada con ítems reales: `@Throttle()` por endpoint público (F3 H-08, F5 H-13), Zod DTO + `@ApiProperty`, RBAC explícito (F8 C-13 OIDC), RLS policy + `policies.sql` array (F3 C-15), `AuditContextFactory.fromRequest` (F6 H-01), CSP/CORS/HSTS no degradados (F2 H-05), `assertPlatformAdmin` en bypass paths (F10 H-14, ADR-0001), secrets via `env.schema.ts` con superRefine (F3 C-04), PII redacted con `scrubSensitive` lista única (F6).

[F10] 2026-04-28 07:00 iter2 DONE seccion 6 glosario — agregadas referencias a `docs/audit/AUDIT_INDEX.md`, ADR-0001 + ADR-0002, runbooks RB-001 a RB-014 con dueños, `packages/security`, `packages/auth`, `packages/api-client`, scripts `cognito-local-bootstrap.sh` + `localstack-bootstrap.sh`.

[F10] 2026-04-28 07:05 iter2 DONE seccion 7 ADRs — ADR-0001 (bypass-rls-policy) y ADR-0002 (audit-context-factory) marcados COMPLETADOS (autor F10 iter 1). 5 ADRs pendientes listados con prioridad: SQS dedupe→FIFO (P1 Sprint 5), packages/security NPM private (P2), CloudWatch alarms multi-region (P2), coverage thresholds tier policy (P3), runbook lifecycle policy (P3).

[F10] 2026-04-28 07:15 iter2 DONE seccion 8 lecciones por bundle — extraídas 3-5 lecciones específicas por F<N>-report.md. F1 (PDF 2-pass + S3 metadata + tests recompute hash), F2 (cookie segregation + CSP frame-src ortogonal + best-effort persist), F3 (env superRefine blocklist + AWS SDK Tags + RLS_E2E gate), F4 (state machine batches + UPDATE…RETURNING + pre-cómputo loops chunked), F5 (signature crypto > regex + DB-side idempotency + class-level throttle + zombie-code defense), F6 (full SHA chain + single source of truth scrub + enum extend > subAction), F7 (single source cookie + `secure` allowlist NODE_ENV + logout siempre POST + defense-in-depth Origin), F8 (Terraform variable scoping + custom metrics emisor cableado + CloudFront us-east-1 + Trivy ignore-unfixed), F9 (façade coverage prohibido + throttle real en e2e + tests no propagation cross-tenant), F10 (where-builder cuando WHERE >1 site + grep casts post-migración + assertPlatformAdmin runtime + cognito-local-bootstrap claim sync).

[F10] 2026-04-28 07:25 iter2 DONE coordinación F8 runbooks — ASIGNACIÓN FINAL CONSENSUADA: F8 dueño de RB-001/002/004/005/007/013, F10 dueño de RB-009 (KMS rotation) + RB-010 (IRP P1 triage). RB-011-dast-failure.md y RB-012-waf-rules.md ya estaban completos pre-fixes (sin dueño nuevo). RB-014-sqs-topic-rename-drain.md owned by F8 (relacionado a NEW-FINDING infra rename certs→pdf). Los 4 runbooks que el audit pidió originalmente con esa numeración (rate-limit-spike, export-rate-limit-exceeded, batch-stuck-processing, pdf-generation-backlog) NO se renumeran — quedan deferred a Sprint 5+ con slots RB-015+ libres. NO toqué los runbooks de F8.

[F10] 2026-04-28 07:30 iter2 DONE TL;DR ejecutivo — agregado al inicio del DEVELOPER_GUIDE.md: 15 Critical + 25 High cerrados (iter 1+2 consolidado), Compliance V2 89.4% → ~95%, instrucción explícita "Sprint 4+ developers MUST read sections 1+2 before any PR".

[F10] 2026-04-28 07:35 iter2 iter2-complete — DEVELOPER_GUIDE.md listo para Sprint 4+. 8 secciones completas + TL;DR. NO modifiqué code de otros agentes; sólo consolidé documentación basada en F1..F10 reports + feed. Sin tests scoped (consolidador role). NO bloquea ningún gate.
```
