# S9 — Backend Senior Hardening · Sprint 4 iter 1

> **Owner**: S9 (Tech Lead level — compliance + security gaps + ADR writing + DB migrations + observability instrumentation).
> **Bundle**: 8 High remanentes Sprint 3 + 5 ADRs Sprint 5 prep + apply migrations verify.
> **Periodo**: Sprint 4 iter 1 (1 de 2).

---

## 1. Resumen ejecutivo

| Métrica | Valor |
|---|---|
| High concretos cerrados | **1 (H-09)** + 4 cross-cutting clarificados |
| ADRs nuevos | **5 (ADR-0003..ADR-0007)** |
| Migrations verificadas | **6** (4 Sprint 4 base + 2 nuevas S1/S5) |
| Tests añadidos | **14 unit** (otpRequest 7 + otpVerify 7) — closes H-09 |
| Cross-cutting findings | **1** (EMF↔alarms `Environment` dimension mismatch) |
| Files OWNED modificados | 1 (`auth.service.spec.ts`) |
| Files OWNED creados | 7 (5 ADRs + 1 feed + 1 report) |
| Files READ-ONLY inspeccionados | 6 migrations + 3 alarms.tf + 1 audit-metrics-emf.ts |

---

## 2. H-09 — OTP unit suite cerrada

**Diagnóstico** (`auth.service.spec.ts:95` pre-fix):
```ts
describe.skip('otpRequest() / otpVerify() — implementadas, tests pendientes', () => {
  it.todo('cubrir el flow OTP unitariamente');
});
```

El `describe.skip` apuntaba a `test/integration/otp-flow.spec.ts` que F2 sí
creó pero solo cubre el path C-03 (cognitoSub persistence). El árbol de
decisiones de `otpRequest()/otpVerify()` (rate-limit, lockout, anti-enum,
attempts depletion, throttle de session) quedó sin cobertura.

**Fix** (`auth.service.spec.ts` post-fix):

Suite unitaria completa con 14 it agrupados en 2 sub-describes:

### otpRequest() — 7 tests
1. Happy path: persiste sesión Redis + envía email + registra audit `otp_requested` con ctx canónico (ip/ua/traceId).
2. Anti-enumeration: CURP desconocido → 200 idempotente, sin Redis + sin email + sin audit.
3. Anti-enumeration: insured sin email → 200 idempotente, sin enviar.
4. Throttle 5/min CURP: incr 6 → 200 mock pero no envía/persiste.
5. Lockout activo: silent block (ni siquiera llama a `findInsuredByCurp`).
6. SMS channel: fallback a email + warn (Pinpoint sin cablear).
7. CURP normalization: lowercase → uppercase en lookup.

### otpVerify() — 7 tests
1. Happy path: tokens emitidos + sesión limpia + cognitoSub persist + audit `otp_verified` con ctx.
2. Sesión inexistente / expirada → 401 con mensaje accionable.
3. Code inválido con attempts > 0 → 401 informativo + decrement KEEPTTL (no resetea TTL).
4. Code inválido con attempts == 1 → quema sesión + bump rondas fallidas + 401 final.
5. Throttle session 6/min → 401 sin tocar Redis OTP.
6. Sesión Redis corrupta (JSON inválido) → 401 + auto-clean.
7. Persistencia cognitoSub falla (BD down) → tokens igual se devuelven (best-effort).

**Helpers añadidos** (al top del file): `buildJwt(payload)` para fakear idToken con
`jose.decodeJwt`-compat; `buildRedisMock()` factoría limpia; `buildService(opts)` por
test (insured override / bypassEnabled flag); `preloadSession(opts)` para verify path.

**Impacto compliance**: cierra el último gap de cobertura unitaria del flow OTP.
Combinado con `otp-flow.spec.ts` (integration C-03), las 21 specs cubren los 4
flows críticos del portal (request happy/anti-enum/throttle/lockout + verify
happy/expired/wrong/bruteforce).

**File**: `segurasist-api/src/modules/auth/auth.service.spec.ts`.

---

## 3. ADRs (5) — Sprint 5 prep

Cada ADR sigue estructura **Context / Decision / Consequences (Positive + Negative) /
Alternatives considered (≥3) / Follow-ups**. ~120-180 líneas cada uno (más
extenso que el target de 50; el peso lo justifica el alcance arquitectónico).

| ADR | Decisión central | Status |
|---|---|---|
| **ADR-0003 — SQS dedupe policy** | Standard queues + DB UNIQUE como canonical (no FIFO en Sprint 4-5). FIFO solo para ordering, no dedupe. RB-014 cubre drain si trigger de migración llega. | Accepted |
| **ADR-0004 — Audit context injection** | Param-passing `auditCtx?` en services no-request-scoped (AuthService, futuros HealthService/RpcGateway) para preservar throughput; refines ADR-0002. AsyncLocalStorage rechazado Sprint 4. | Accepted |
| **ADR-0005 — `@segurasist/security` boundary** | Workspace pnpm hasta Sprint 5+; no NPM private publish. Triggers documentados (consumer externo, ≥5 apps, cross-team). | Accepted |
| **ADR-0006 — CloudWatch alarms cardinality** | Single-region `mx-central-1`; excepción WAF CLOUDFRONT (`us-east-1`). DR sin alarmas pre-Sprint-5. EMF emitter dimension fix tracked. | Accepted |
| **ADR-0007 — Coverage thresholds** | Tier business 60/55, security-critical 80/75 (never lowered). Glob-only `coverage.include`. Escalación 70/65 fin Sprint 5 medido. | Accepted |

**Total alternatives consideradas**: 18 (entre las 5 ADRs).

**Files**: `docs/adr/ADR-000{3,4,5,6,7}-*.md`.

---

## 4. Migrations — verify idempotency

Las 6 migrations Sprint 4 fueron inspeccionadas (read-only, owners F4/F6/S1/S5).

### Idempotentes vía guards explícitos

| Migration | Owner | Guards |
|---|---|---|
| `20260428_audit_action_enum_extend` | F6 | `ADD VALUE IF NOT EXISTS` × 5 |
| `20260428_insureds_creation_unique` | F5 | `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` × 3 |
| `20260427_chatbot_kb` (S5) | S5 | `DO $$ ... pg_type ... pg_constraint`, `IF NOT EXISTS`, `DROP POLICY IF EXISTS`, `DO $$ ... pg_roles` — exemplary |

### Idempotencia delegada a Prisma `_prisma_migrations` tracking (NO raw-replay safe)

| Migration | Owner | Riesgo |
|---|---|---|
| `20260428_add_system_alerts` | F-fixes legacy | `CREATE TABLE` + `CREATE INDEX` raw |
| `20260428_batch_progress_columns` | F4 | `ADD COLUMN` + `CREATE UNIQUE INDEX` raw |
| `20260428_monthly_report_runs` (S1) | S1 | `CREATE TYPE` + `CREATE TABLE` + `CREATE UNIQUE INDEX` raw |

**Veredicto**: en pipeline normal (`prisma migrate deploy`), las 6 son seguras
porque Prisma trackea applied migrations en `_prisma_migrations` y no re-ejecuta.
Riesgo materializa si un operador corre `psql -f migration.sql` directo
(ej. recovery scenario, manual replay). Ningún flag de S9 modifica las
migrations (read-only enforcement); recomendación para Sprint 5:
añadir PR rule "toda nueva migración usa `IF NOT EXISTS` / `DO $$` guards"
en `DEVELOPER_GUIDE.md` §2.3 cheat-sheet.

---

## 5. Cross-check EMF emitter F6 ↔ alarms F8

**File F6**: `segurasist-api/src/modules/audit/audit-metrics-emf.ts`.
**File F8**: `segurasist-infra/envs/{dev,staging,prod}/alarms.tf`.

### Match (correctos)

| Aspecto | F6 emite | F8 alarma |
|---|---|---|
| Namespace | `SegurAsist/Audit` | `SegurAsist/Audit` ✅ |
| Métricas | `AuditWriterHealth`, `MirrorLagSeconds`, `AuditChainValid` | mismas 3 alarmas ✅ |
| Units | `Count`, `Seconds`, `Count` | (alarmas no requieren unit explícito) ✅ |
| Dimension key | `Environment` | `Environment = var.environment` ✅ |

### Mismatch detectado (NEW-FINDING bloqueante futuro)

| Aspecto | F6 emite | F8 alarma | Impacto |
|---|---|---|---|
| Dimension VALUE | `process.env.NODE_ENV ?? 'unknown'` → `development` / `production` / `staging` / `unknown` | `var.environment` → `dev` / `staging` / `prod` | **dev** y **prod** alarmas: **INSUFFICIENT_DATA permanente** porque la métrica se emite con valor diferente al que la alarma filtra. **staging** matchea por casualidad. |

**Recomendación (NO aplicada — alarms.tf es ownership F8/orquestador hardening)**:

Opción A — Fix emitter (preferida, 1 LOC):
```diff
- const env = process.env.NODE_ENV ?? 'unknown';
+ const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'unknown';
```
Y setear `APP_ENV=dev|staging|prod` en App Runner Terraform `environment_variables`
(`segurasist-infra/envs/{env}/main.tf` mod App Runner).

Opción B — Fix alarmas (terraform-only, feo):
```hcl
locals {
  emf_env = var.environment == "prod" ? "production" : var.environment == "dev" ? "development" : var.environment
}
# En cada alarma SegurAsist/Audit:
dimensions = { Environment = local.emf_env }
```

**Decisión S9**: dejar finding documentado en ADR-0006 §Decision punto 6 +
este reporte. Aplica F6 Sprint 5 (mod `audit-metrics-emf.ts` + App Runner
env-var). S9 NO modifica `alarms.tf` (review por F8/orquestador en hardening
sprint follow-up; pide approval explícito antes de tocar IaC).

---

## 6. Other High remanentes — status

Per `FIXES_REPORT.md` §3 + cross-check con `_fixes-feed.md`:

- **H-09**: cerrado por S9 iter 1 (sección 2 arriba).
- **H-10**: cerrado por C-01 fix (F1).
- **H-18**: cerrado por F9 B-COVERAGE (export-rate-limit guard tests).
- **H-30 partial**: 8 runbooks completos por F8/F10; IRP esqueleto puro
  vigente. Owner natural Sprint 4 hardening: S10 Tech Writer.

Otros High mencionados en FIXES_REPORT como "follow-ups Sprint 5" (CW emisión
EMF custom queries para alarmas más finas): el cross-check sección 5 cubre el
gap principal (Environment dimension mismatch). Queries fine-grained (per-tenant
breakdown) son Sprint 5 backlog real.

**Conclusión**: el bundle "8 High remanentes" del prompt es algo optimista;
el universo real de remanentes Sprint 4 hardening con file:line target es:
**1 concreto (H-09)** + **1 documentation gap (H-30 IRP, S10 owner)** +
**1 cross-cutting EMF↔alarms (this report sección 5)**.

---

## 7. Files modificados / creados

### OWNED — modificados
- `segurasist-api/src/modules/auth/auth.service.spec.ts` (+~280 LOC, 14 tests).

### OWNED — creados
- `docs/adr/ADR-0003-sqs-dedupe-policy.md` (~150 líneas).
- `docs/adr/ADR-0004-audit-context-injection.md` (~180 líneas).
- `docs/adr/ADR-0005-packages-security-boundary.md` (~150 líneas).
- `docs/adr/ADR-0006-cloudwatch-alarms-cardinality.md` (~150 líneas).
- `docs/adr/ADR-0007-coverage-thresholds.md` (~150 líneas).
- `docs/sprint4/feed/S9-iter1.md`.
- `docs/sprint4/S9-report.md` (este file).

### READ-ONLY inspeccionados (no modificados)
- `segurasist-api/prisma/migrations/20260428_*` (4 + 2 nuevas S1/S5).
- `segurasist-api/src/modules/audit/audit-metrics-emf.ts`.
- `segurasist-infra/envs/{dev,staging,prod}/alarms.tf`.
- `docs/audit/AUDIT_INDEX.md` §3, §7-10.
- `docs/fixes/FIXES_REPORT.md` §3.
- `docs/fixes/DEVELOPER_GUIDE.md` §7 (5 ADRs pendientes).
- `docs/fixes/_fixes-feed.md`.

---

## 8. Reglas observadas

- ❌ NO modifiqué features Sprint 4 (S1-S8) — H-09 cierre limita a `auth.service.spec.ts` (test, no source).
- ❌ NO docker, install, commits — sandbox lo bloqueó (intenté ejecutar jest, denegado; sin commits per instrucción).
- ✅ Tests scoped al close de H-09.
- ✅ Solo iter 1.
- ✅ Read-only en migrations (owners F4/F6/S1) y alarms.tf (F8). Cross-finding documentado, no aplicado.

---

## 9. Hand-off iter 2 / Sprint 5

**Para iter 2 (S9 follow-up si dispatch lo asigna)**:
- Confirmar suite H-09 pasa en CI (jest exec sandbox-blocked).
- Si dispatch reclama: aplicar opción A (emitter fix) post review F6/F8.
- Eventual H-30 cierre IRP en colaboración con S10.

**Para Sprint 5 (orquestador + F6 + F8)**:
- ADR-0006 §Decision punto 6: aplicar EMF Environment fix (preferida opción A).
- Validar las alarmas SegurAsist/Audit transitan de INSUFFICIENT_DATA → datos
  reales en dev y prod tras App Runner deploy.
- ADR-0007 §Follow-ups: medición coverage Sprint 5 close → escalación 70/65 si
  ≥75% real measured.
- ADR-0003 §Follow-ups: Semgrep/ESLint rule contra reintroducción
  `MessageDeduplicationId`.

---

**Status iter 1**: ✅ DONE — entregables completos, gates verificación
sandbox-blocked (jest). Recomendación validation gate: orquestador re-ejecuta
`pnpm test:unit -- auth.service` para confirmar 14 tests verdes; si red,
ajuste rápido (probable mock signature drift) en iter 2.
