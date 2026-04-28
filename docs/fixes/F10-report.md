# Fix Report — F10 (B-DRY + B-UX-FIXES + B-DOCS + B-COGNITO-CLAIMS + B-TYPES-CLEANUP + B-BYPASS-AUDIT)

> Senior Engineer Generalist + Tech Writer · Tech Lead level. Adicional rol:
> consolidador final del `docs/fixes/DEVELOPER_GUIDE.md`.

## Iter 1 (resumen)

### Issues cerrados

| # | File:Line | Bundle | Notas |
|---|-----------|--------|-------|
| **H-14** | `src/common/guards/assert-platform-admin.ts` (NUEVO) | B-BYPASS-AUDIT | Helper runtime + spec 8 cases. Aplicado en 9 controllers (tenants, users, insureds, packages, coverages, batches, audit, reports, certificates). |
| **H-16** | `insureds.service.ts:673`, `claims.service.ts:87`, `certificates.service.ts:202` | B-TYPES-CLEANUP | 3 casts `as unknown as Prisma.InsuredWhereInput` eliminados (deuda residual post-migración cognito_sub Sprint 4). En `certificates.service.ts` también removido el import `type { Prisma }` que quedaba unused. |
| **H-17** | `src/modules/insureds/where-builder.ts` (NUEVO) | B-DRY | `buildInsuredsWhere(filter)` shared. 3 callers migrados: `list`, `buildExportWhere` (1-line delegator), `reports-worker.queryInsureds`. 9 specs nuevos cubren OR shape + ranges + combinaciones. |
| **H-25** | `apps/admin/app/_components/mobile-drawer.tsx`, `apps/admin/app/(app)/layout.tsx` | B-UX-FIXES | Mock `<Select defaultValue="mac">` reemplazado por `<TenantSwitcher>` real (mismo backing TanStack Query + Zustand store que desktop). Para non-superadmin: `<TenantSwitcherDisabledForRole>` con `ownTenantLabel={me.tenantId}`. |
| **H-27** | `scripts/cognito-local-bootstrap.sh` | B-COGNITO-CLAIMS | `ensure_user` ahora acepta variadic args 6/7 (given_name/family_name); insured demo bootstrapped con "María"/"Hernández" coincidiendo con seed.ts. |
| **H-30 (parcial)** | `RB-009-kms-cmk-rotation.md`, `RB-010-irp-triage-p1.md` | B-DOCS | 2 runbooks completos: RB-009 (KMS rotation, scheduled + compromise paths), RB-010 (IRP P1 triage con regulatory comms LFPDPPP México art. 64). |

### Tests añadidos

- `src/modules/insureds/where-builder.spec.ts` — **9 specs** (default shape, q en 4-element OR, q.trim, status+packageId eq, validFrom/To ranges, combined filters, no-tenantId/no-cursor caller-scoped).
- `src/common/guards/assert-platform-admin.spec.ts` — **8 specs** (undefined/null, no-role, admin_mac/insured rejected, admin_segurasist passed, platformAdmin=true passed, message stability).

**Total**: 17 specs nuevos.

### Tests existentes corridos

- ⚠️ **BLOCKED** — sandbox bloquea `pnpm test` / `jest`. Verificación delegada a F0 gate D4. Revisión manual: el refactor del `where-builder` preserva la shape exacta del WHERE (toMatchObject permissive en `insureds.service.spec.ts` sigue verde por construcción); cast cleanups son strict typing improvements (Prisma client ya tipa `cognitoSub`).

### Cross-cutting findings (NEW-FINDINGs)

1. **Renumeración de runbooks audit↔repo** — el audit pidió `RB-009-rate-limit-spike`, `RB-010-export-rate-limit-exceeded`, `RB-011-batch-stuck-processing`, `RB-012-pdf-generation-backlog`, pero los slots existentes son KMS, IRP, DAST, WAF. Llené los 2 slots TBD (RB-009 KMS, RB-010 IRP). En iter 2 coordinar con F8 para asignar los 4 nombres del audit a `RB-013+` o renombrar.
2. **`where-builder` tipo estricto en worker** — el builder no captura `tenantId`; el worker lo inyecta post-build con un `as Record<string, unknown>`. Wrapper `buildInsuredsWhereForWorker(filter, tenantId)` ergonómico para iter 2 si vale la pena.
3. **Coordinación F1↔F10 en `certificates.service.ts:202`** — F1 dejó el cast cleanup para iter 2; F10 lo aplicó en iter 1 por ser trivial. El audit ctx en `urlForSelf` sigue siendo de F6 iter 2 (el archivo está en F1's iter 1 + F6's iter 2 pero el cast no toca el audit code).

### ADRs nuevos

- `docs/adr/ADR-0001-bypass-rls-policy.md` — Bypass RLS service policy. Context/Decision/Consequences/Alternatives. 4 alternativas analizadas y rechazadas con razón. Follow-ups Sprint 5+.
- `docs/adr/ADR-0002-audit-context-factory.md` — Audit context factory injection (referencia el work de F6 B-AUDIT). 4 alternativas analizadas.

## Iter 2 (resumen — CONSOLIDADOR ROLE)

### Trabajo realizado

Iter 2 fue íntegramente role de consolidador. Releídos los 10 `F<N>-report.md` (incluyendo iter 2 follow-ups de F1, F2, F3, F4 ya cerradas en feed) + `_fixes-feed.md` completo (~74KB) + AUDIT_INDEX.md secciones 1-2 para verificación cruzada de severidades. Output único:

**`docs/fixes/DEVELOPER_GUIDE.md`** — 8 secciones completas + TL;DR ejecutivo:

1. **Sección 1 (anti-patterns 1.1-1.11)** — 11 patterns documentados con: evidencia Sprint 3 (`file:line`), fix Sprint 4 (PR/files cerrados), regla preventiva (4 bullets accionables) y lección Sprint 4+. Las secciones 1.8-1.11 ya estaban iter 1; en iter 2 expandí 1.1-1.7 con el mismo nivel de detalle. Total: ~1100 líneas de documentación.
2. **Sección 2 (cheat-sheet)** — 5 sub-bloques (endpoint nuevo, SQS worker, RLS table, FE route, audit action) con snippets copy-paste-ready ≤6 líneas + bullets accionables.
3. **Sección 3 (setup local-dev)** — agregado `rm -rf .next` post-merge (F2 NEW-FINDING #2), `pnpm install` post-merge (F7 symlinks + F9 api-client devDeps), suite completa post-fixes con todos los specs nuevos.
4. **Sección 4 (CI/CD gates)** — tabla con thresholds reales aplicados por F9: 60/55/60/60 BE/portal/admin/ui/api-client; 80/75/80/80 packages/auth + packages/security. Lighthouse port correcto, ZAP/Trivy desbloqueados.
5. **Sección 5 (PR checklist)** — 17 items reales referenciando issues cerrados (`@Throttle`, `assertPlatformAdmin`, RLS policy + array, `AuditContextFactory.fromRequest`, `scrubSensitive` único, env superRefine, cognito-local-bootstrap sync, etc).
6. **Sección 6 (glosario)** — referencias a AUDIT_INDEX, ADR-0001/0002, runbooks RB-001..014, packages workspace, scripts, compliance docs.
7. **Sección 7 (ADRs)** — ADR-0001 + ADR-0002 marcados COMPLETADOS (autor F10 iter 1). 5 pendientes con prioridad (P1: SQS dedupe→FIFO; P2: packages/security NPM private, CloudWatch multi-region; P3: coverage tier policy, runbook lifecycle).
8. **Sección 8 (lecciones por bundle F1..F10)** — 5 lecciones específicas por bundle extraídas de cada `F<N>-report.md`. Total 50 lecciones.
9. **TL;DR ejecutivo** al inicio: tabla de impacto (15 Critical + ~25 High cerrados, compliance V2 89.4% → ~95% estimado) + instrucción "secciones 1+2 lectura OBLIGATORIA antes de PR".
10. **Reading order** al final para nuevos developers.

### Coordinación F8 runbooks (Tarea 2)

ASIGNACIÓN FINAL CONSENSUADA documentada en feed iter 2:

| Runbook | Owner | Status |
|---|---|---|
| RB-001 (api-down) | F8 | DONE iter1 |
| RB-002 (rds-cpu-high) | F8 | DONE iter1 (reemplaza legacy) |
| RB-003 (failover-cross-region) | preexistente | OK |
| RB-004 (sqs-dlq) | F8 | DONE iter1 (reemplaza legacy) |
| RB-005 (waf-spike) | F8 | DONE iter1 (reemplaza legacy) |
| RB-006 (guardduty-critical) | preexistente | OK |
| RB-007 (audit-degraded) | F8 | DONE iter1 (reemplaza legacy) |
| RB-008 (rds-pitr-restore) | preexistente | OK |
| **RB-009 (kms-cmk-rotation)** | **F10** | DONE iter1 |
| **RB-010 (irp-triage-p1)** | **F10** | DONE iter1 |
| RB-011 (dast-failure) | preexistente | OK |
| RB-012 (waf-rules) | preexistente | OK |
| RB-013 (audit-tampering) | F8 | DONE iter1 (cierra C-10 cross-cutting) |
| RB-014 (sqs-topic-rename-drain) | F8 | DONE iter1 |

NO toqué los runbooks de F8. Los 4 nombres alternativos del audit (rate-limit-spike, export-rate-limit-exceeded, batch-stuck-processing, pdf-generation-backlog) NO se renumeran — quedan deferred a Sprint 5+ en slots RB-015+ libres.

### Tests añadidos iter 2

Ninguno. Iter 2 es role de consolidador; no introduce código de producción.

### Cross-cutting findings iter 2

Ninguno. La consolidación detectó consistencia entre los reports F1..F10; los NEW-FINDINGS pendientes ya están enumerados en el feed iter 1 con dueños y prioridades para Sprint 5.

### Follow-ups Sprint 5+ (anotados en DEVELOPER_GUIDE sección 7)

- ADR-0003 sqs-dedupeid-vs-fifo-migration (P1, F5).
- ADR-0004 packages-security-npm-private-vs-workspace (P2, F7).
- ADR-0005 cloudwatch-alarms-cardinality-multi-region (P2, F8).
- ADR-0006 coverage-thresholds-tier-policy (P3, F9).
- ADR-0007 runbook-lifecycle-policy (P3, F8).
- F6 emisor de custom metrics audit (`SegurAsist/Audit/AuditWriterHealth`, `MirrorLagSeconds`, `AuditChainValid`) via CloudWatch EMF (out-of-scope iter 2; bloquea las 3 alarmas custom de F8 que quedan en INSUFFICIENT_DATA).
- F0 crear `.github/workflows/terraform-plan.yml` consumiendo outputs `tf_role_arns.plan_{staging,prod}` de F8 C-13.
- Considerar `buildInsuredsWhereForWorker(filter, tenantId)` wrapper ergonómico (low priority, sólo si el cast `as Record<string, unknown>` se vuelve común en workers).

## Compliance impact

- **H-14 → ISO 27001 A.9.4.1 (control runtime)**: defense-in-depth en el path BYPASSRLS; el RolesGuard ya lo valida pero un regresión queda contenida.
- **H-25 → SOC 2 CC1.4 (UX consistency)**: mobile users ven el tenant real, no el mock. Sprint 5 multi-tenant feedback gates pueden confiar en este path.
- **H-27 → UX**: portal asegurado lee identidad real desde JWT (greeting personalizado), reduce tickets Tier-1 "no es mi nombre".
- **H-30 (parcial) → ISO 27001 A.16, LFPDPPP art. 64**: 2 runbooks operacionales (KMS + IRP) listos para on-call.

## Lecciones para DEVELOPER_GUIDE.md

(Ya integradas en `docs/fixes/DEVELOPER_GUIDE.md` secciones 1.8 expandida, 1.9, 1.10, 1.11 y mi entry en sección 8 F10. Resumen):

- **Triplicación byte-idéntica**: tests por orden (`or[3]`) NO detectan drift entre callers, sólo rotación. Cualquier WHERE en >1 site → `<resource>/where-builder.ts`.
- **Casts post-migración**: `as unknown as Prisma.X` es deuda residual cuando una migración añade un campo. Grep + remove tras cada Prisma migration merge.
- **Bypass RLS**: el RolesGuard NO es suficiente — defense-in-depth runtime con `assertPlatformAdmin(req.user)` en `buildScope`/`toCtx` de cada controller que rutea a un service con bypass.
- **Cognito claims**: cuando el FE consume un nuevo claim del JWT, sincronizar `cognito-local-bootstrap.sh` en el mismo PR — sino el dev-loop cae a fallbacks que no representan prod.
- **ADR templates**: Context / Decision / Consequences / Alternatives considered. Cada alternativa con razón de rechazo. Follow-ups explícitos al final.
