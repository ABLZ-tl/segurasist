# F10 — feed entries iter 1

> Bundle: B-DRY + B-UX-FIXES + B-DOCS + B-COGNITO-CLAIMS + B-TYPES-CLEANUP + B-BYPASS-AUDIT.
> Append-only. F0 orquestador integra estas entradas a `docs/fixes/_fixes-feed.md`.

```
[F10] 2026-04-28 03:00 iter1 STARTED docs/audit/AUDIT_INDEX.md — F10 inicia bundle B-DRY + B-UX-FIXES + B-DOCS + B-COGNITO-CLAIMS + B-TYPES-CLEANUP + B-BYPASS-AUDIT (H-14, H-16, H-17, H-25, H-27, H-30 partial)

[F10] 2026-04-28 03:25 iter1 DONE H-17 segurasist-api/src/modules/insureds/where-builder.ts (NUEVO) — `buildInsuredsWhere(filter)` shared. Migra los 3 callers byte-idénticos: insureds.service.ts:list (línea 275), insureds.service.ts:buildExportWhere (ahora 1-line delegator a builder), workers/reports-worker.service.ts:queryInsureds (donde se inyecta tenantId explícito post-bypass). Tests nuevos en where-builder.spec.ts (9 specs cubriendo OR shape, ranges, combinaciones).

[F10] 2026-04-28 03:35 iter1 DONE H-16 segurasist-api/src/modules/insureds/insureds.service.ts:673, segurasist-api/src/modules/claims/claims.service.ts:87, segurasist-api/src/modules/certificates/certificates.service.ts:202 — eliminados los 3 casts `as unknown as Prisma.InsuredWhereInput` (deuda residual post-migración Sprint 4 cognito_sub). El typing de Prisma client ya cubre el campo. En certificates.service.ts también removí el import `type { Prisma } from '@prisma/client'` que ya no se usa (otros archivos siguen usándolo: insureds y claims mantienen el import por `Prisma.InputJsonValue` y `Prisma.PrismaClientKnownRequestError`).

[F10] 2026-04-28 03:50 iter1 DONE H-14 segurasist-api/src/common/guards/assert-platform-admin.ts (NUEVO) — helper runtime + spec (8 cases). Aplicado en buildScope/toCtx de: tenants.controller.ts, users.controller.ts, insureds.controller.ts, packages.controller.ts, coverages.controller.ts, batches.controller.ts (list+findOne), audit.controller.ts (list+verify-chain), reports.controller.ts, certificates.controller.ts. Workers (reports-worker, email-worker, mailpit-tracker, insureds-creation-worker, layout-worker, pdf-worker) y AuthService.findInsuredByCurp explícitamente OUT-of-scope (no req.user) — documentados en ADR-0001 con justificación.

[F10] 2026-04-28 03:55 iter1 DONE H-25 segurasist-web/apps/admin/app/_components/mobile-drawer.tsx — replaza el mock `<Select defaultValue="mac">` con `<TenantSwitcher>` real (mismo backing TanStack Query + Zustand store que desktop). Para non-superadmin: `<TenantSwitcherDisabledForRole ownTenantLabel={…}/>`. Layout `(app)/layout.tsx` ahora pasa `ownTenantLabel={me.tenantId}` al MobileDrawer (mismo prop que TenantSwitcher desktop). // NOTA: el audit reportaba el path como `apps/portal/components/mobile-drawer.tsx` pero el mobile-drawer real está en admin (no hay equivalente en portal — el portal no tiene tenant switcher porque el insured solo tiene un tenant). Fix aplicado en admin que es donde el bug existe.

[F10] 2026-04-28 03:58 iter1 DONE H-27 segurasist-api/scripts/cognito-local-bootstrap.sh — `ensure_user` ahora acepta variadic args 6/7 (given_name, family_name); insured demo bootstrapped con "María"/"Hernández" coincidiendo con seed.ts (Hernández García María). Admin/operator/supervisor sin cambios (no necesitan estos claims). El portal asegurado leerá given_name del idToken en lugar de caer al fallback derivado del email.

[F10] 2026-04-28 04:05 iter1 DONE docs/adr/ADR-0001-bypass-rls-policy.md (NUEVO) — Context/Decision/Consequences/Alternatives. Documenta los 16 callers de PrismaBypassRlsService, política de invocación (HTTP endpoints → assertPlatformAdmin; workers → JSDoc + tenantId explícito; AuthService.findInsuredByCurp → throttle + IP allowlist). 4 alternativas consideradas y rechazadas con razón.

[F10] 2026-04-28 04:08 iter1 DONE docs/adr/ADR-0002-audit-context-factory.md (NUEVO) — referencia el work de F6 B-AUDIT. Decisión: AuditContextFactory singleton (NO request-scoped) invocado en controllers, pasado como AuditContext POJO a services. 4 alternativas analizadas (pure function, request-scoped, custom decorator, build-inside-AuditWriter).

[F10] 2026-04-28 04:18 iter1 DONE H-30(parcial) segurasist-infra/docs/runbooks/RB-009-kms-cmk-rotation.md — runbook completo: 3 triggers (programado/compromise/personnel), 5 pasos detection, dos caminos de recovery (Camino A scheduled, Camino B compromise-driven), validación post-rotación, postmortem template. // F8 tiene RB-001/002/004/005/007/013 — sin overlap.

[F10] 2026-04-28 04:25 iter1 DONE H-30(parcial) segurasist-infra/docs/runbooks/RB-010-irp-triage-p1.md — runbook completo P1 IRP: triangulación 2-fuentes, queries SQL audit_log + GuardDuty + VPC Flow Logs, containment ≤1h (cognito disable, IAM rotation, WAF block, RDS replica off, S3 deny), customer comms ≤72h (LFPDPPP México art. 64 + GDPR-equivalent + plantilla regulator/cliente B2B/sujeto/público), postmortem template, métricas anuales.

[F10] 2026-04-28 04:30 iter1 NEW-FINDING segurasist-infra/docs/runbooks/RB-011-dast-failure.md / RB-012-waf-rules.md — ya están completos (no son TBD), no requieren intervención. La numeración del audit ("RB-009-rate-limit-spike", "RB-010-export-rate-limit-exceeded", "RB-011-batch-stuck-processing", "RB-012-pdf-generation-backlog") NO matchea los archivos existentes (que son KMS, IRP, DAST, WAF). Reasignar la lista del audit a slots libres (RB-013+) en iter 2 con F8.

[F10] 2026-04-28 04:35 iter1 NEW-FINDING segurasist-api/src/modules/insureds/where-builder.ts — el builder NO captura el `tenantId` filter explícito. El worker (BYPASSRLS) lo añade post-build inyectándolo en `where as Record<string, unknown>`. Si en iter 2 alguien quisiera tipar más estrictamente, considerar exponer un wrapper `buildInsuredsWhereForWorker(filter, tenantId)` que evite el cast. Out-of-scope iter 1 (ergonómico, no funcional).

[F10] 2026-04-28 04:40 iter1 NEW-FINDING coordinacion F1 + F6 cross-cutting — F1 cerró iter 1 sin tocar urlForSelf cast (lo dejó para iter 2). Yo (F10) hice el cast cleanup en iter 1 (trivial: solo eliminar `as unknown as ...`). El audit ctx integration en certificates.urlForSelf sigue siendo de F6 iter 2 (ya tienen el archivo en su scope). NO conflict.

[F10] 2026-04-28 04:42 iter1 DONE docs/fixes/DEVELOPER_GUIDE.md (parcial) — agregadas mis lecciones (secciones 1.8 expandida, 1.9 nueva H-16 cleanup, 1.10 nueva H-14 ADR, 1.11 nueva H-27 cognito claims) + mi entry completa en sección 8 F10. Las secciones 1.1-1.7, 2 cheat-sheet, 3-7 las consolido en iter 2 leyendo todos los F<N>-report.md.

[F10] 2026-04-28 04:45 iter1 BLOCKED tests — sandbox bloquea pnpm/jest exec. Verificación de los 9 specs nuevos del where-builder + 8 specs nuevos del assert-platform-admin queda pendiente para gate D4 (F0) o iter 2. Revisión manual: tipos correctos, no introducí infra nueva.

[F10] 2026-04-28 04:47 iter1 iter1-complete — F10 cierra H-14 + H-16 + H-17 + H-25 + H-27 + H-30(parcial: RB-009 + RB-010). Tests scoped: 17 nuevos (where-builder.spec.ts 9, assert-platform-admin.spec.ts 8). 2 ADRs nuevos. 2 NEW-FINDINGs (renumeración runbooks audit→repo, tipo estricto del where-builder en worker). Listo para iter 2 como CONSOLIDADOR del DEVELOPER_GUIDE.md.
```
