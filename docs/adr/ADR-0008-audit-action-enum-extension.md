# ADR-0008 — AuditAction enum extension policy

- **Status**: Accepted (Sprint 4 hardening iter 2, 2026-04-29)
- **Authors**: S9 (consolidates Sprint 4 cross-bundle finding from S1/S3/S5/S6/S10)
- **Audit refs**: `docs/audit/AUDIT_INDEX.md` §enum-extension, `docs/sprint4/_features-feed.md` `[S5] iter1 NEW-FINDING audit-action`, `[S10] iter1 NEW-FINDING enum AuditAction`, `[S1] iter1 NEW-FINDING audit-action-enum`
- **Trigger**: Sprint 4 introdujo 5 dominios nuevos que necesitaban valores del enum `audit_action` (chatbot message + escalate, reports generated + downloaded, monthly report sent). 4 owners (S1, S3, S5, S6) inicialmente codificaron el sub-action en `payloadDiff.subAction` o `resourceType` como workaround. S5 iter 2 publicó la migración unificada `20260429_audit_action_sprint4_extend` que agregó los 5 valores. Esta ADR formaliza la **política** de extensión para evitar que Sprint 5+ re-vuelva al patrón fragmentado.

## Context

El enum `audit_action` en `prisma/schema.prisma` es `string` enumerado en
PostgreSQL (`CREATE TYPE audit_action AS ENUM (...)`). Los valores
canónicos pre-Sprint-4 cubrían el dominio CRUD genérico + auth:

```
'create' | 'update' | 'delete' | 'read_viewed' | 'export_downloaded'
| 'login' | 'logout' | 'otp_requested' | 'otp_verified'
```

Cuando Sprint 4 abrió 5 nuevos dominios, los owners enfrentaron la
disyuntiva:

- **A)** Extender el enum por dominio (1 migration por bundle).
- **B)** Codificar el sub-action en `payloadDiff` para no bloquear el
  iter (action='create' + payloadDiff.subAction='chatbot_message').
- **C)** Migración unificada al final del sprint que recoge todos los
  valores nuevos.

Iter 1 todos eligieron **B** (más rápido para cerrar el iter), generando
4 NEW-FINDINGs en el feed:

- `[S1] iter1 NEW-FINDING audit-action-enum` — reports usando
  `export_downloaded` + `read_viewed` (existentes); pidiendo
  `report_generated` para granularidad real.
- `[S5] iter1 NEW-FINDING audit-action` — chatbot usando
  `action='create' + resourceType='chatbot.message'` como workaround.
- `[S6] iter1` (implícito en service code) — escalation usando
  `action='update' + payloadDiff.subAction='escalated'`.
- `[S10] iter1 NEW-FINDING enum AuditAction` — consolidación pidiendo
  4 valores nuevos en migration unificada.

Iter 2 S5 publicó la migración consolidada (opción C) con 5 valores
(`chatbot_message_sent`, `chatbot_escalated`, `report_generated`,
`report_downloaded`, `monthly_report_sent`), reemplazando los workaround
en su propio `kb.service`. S1/S3/S6 quedan con backlog Sprint 5 para
migrar sus services al nuevo valor.

El problema de **gobernanza** (cómo prevenir que Sprint 5+ vuelva al
patrón fragmentado o, peor, al workaround payloadDiff) requiere una ADR
para fijar el contrato.

## Decision

### 1. **Cuándo extender el enum** (criterios obligatorios — TODOS deben cumplirse)

Un nuevo valor en `audit_action` se justifica si:

- (a) El sub-action representa una **transición de estado de negocio
  observable** (no un detalle técnico — eso vive en `payloadDiff`).
- (b) Existe **al menos una query** legítima de compliance/alertas/reporting
  que necesite filtrar por ese valor sin escanear `payloadDiff` (JSON).
- (c) El dominio NO tiene un valor genérico ya disponible que cubra el
  caso con `resourceType` + `payloadDiff` razonable. Ejemplo válido:
  `chatbot_message_sent` no encaja en `create` porque el recurso
  conceptual es la conversación, no el mensaje individual; consultar
  "todos los mensajes del chatbot del último mes" sin un valor dedicado
  fuerza scan en `payloadDiff`.
- (d) El owner del bundle tiene **al menos un test integration** que
  asserta el valor (no fixture genérica `'create'`).

Si CUALQUIERA falla → `payloadDiff.subAction` (o `payloadDiff.event`)
sigue siendo la opción correcta.

### 2. **Cómo extender el enum** (mecánica de la migración)

- **Migration name**: `<YYYYMMDD>_audit_action_<scope>_extend` (e.g.
  `20260429_audit_action_sprint4_extend`). Un sprint = una migración
  consolidada (no una por bundle); evita N reconfigure-PG-enum-cache
  events durante un mismo deploy.
- **Sintaxis**: `ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS
  '<value>';` — una sentencia por valor, todas en la misma migración.
- **Idempotencia**: `IF NOT EXISTS` permite re-replay (local dev tras
  reset parcial; replay en recovery). Postgres 12+ requerido (ya está
  garantizado en infra Sprint 1).
- **Naming convention**: snake_case + dominio prefijo + acción verbo
  (`<domain>_<verb>` o `<domain>_<noun>_<verb>` para granularidad).
  Ejemplos:
  - `chatbot_message_sent` ✅ (dominio + recurso + acción)
  - `chatbot_escalated` ✅ (dominio + acción auto-evidente)
  - `report_generated` ✅ (dominio + acción)
  - `monthly_report_sent` ✅ (sub-dominio + acción)
  - ❌ `chatbotMessage` (camelCase, sin verbo)
  - ❌ `escalated` (sin dominio — colisión potencial con
    `claim_escalated` futuro)

### 3. **Coordinación cross-bundle** (anti-fragmentación)

- **Trigger**: si N≥2 bundles del mismo sprint identifican necesidad
  de extender el enum, el owner del bundle más temprano (criterio:
  primer NEW-FINDING en el feed) **prepara** la migración consolidada;
  los demás escriben sus NEW-FINDINGs apuntando al draft.
- **Owner final**: el primer bundle que llegue a iter 2 con todos los
  valores listados merge la migración. Sprint 4: S5 iter 2 ejecutó este
  rol (`20260429_audit_action_sprint4_extend`).
- **Consumers**: el resto de los bundles migran sus services
  (`action: 'create'+payloadDiff.subAction='X'` → `action: 'X'`) en
  el sprint inmediatamente siguiente al merge de la migración. Si no
  alcanzan la ventana, NEW-FINDING explícito como Sprint X+1 backlog.

### 4. **Workaround `payloadDiff.subAction`** (cuándo SÍ usarlo)

Es el patrón correcto cuando:

- El sub-action NO cumple los criterios (1.a-d) de extension.
- Es **transitorio** (e.g. iter 1 gate close mientras se planea la
  migración consolidada para iter 2 / sprint+1).
- Es un **detalle implementación** que no merece query first-class
  (e.g. distinguir `escalation_via_no_match` vs `escalation_via_user_request`
  cuando el agregado `chatbot_escalated` ya cubre el reporting; el
  detalle granular vive en `payloadDiff.cause`).

### 5. **Anti-rollback** (lo que NO se hace)

- ❌ **NO** se agregan valores ad-hoc fuera del proceso (PR sin ADR ref).
- ❌ **NO** se usan valores fuera de `audit_action` para sub-actions
  específicos (anti-pattern: agregar columna `audit_subaction`). El
  enum es la fuente única de verdad; payloadDiff es el escape hatch
  documentado.
- ❌ **NO** se borran valores existentes (Postgres no soporta
  `DROP VALUE` sin `DROP TYPE` + recreate, y eso es ALTER TABLE masivo
  de `audit_logs`). Si un valor queda obsoleto, se deja deprecated en
  el comentario de schema.prisma + se filtra en queries.

### 6. **Audit del audit** (meta-compliance)

Cada migración de enum debe ir acompañada de:

- Update a `docs/fixes/DEVELOPER_GUIDE.md` §2.5 (audit cheat-sheet)
  listando los nuevos valores + cuándo usarlos.
- Update a `tests/security/cross-tenant.spec.ts` HTTP_MATRIX **solo si**
  el nuevo valor habilita un endpoint nuevo (no aplica a transiciones
  internas de service).
- Update al `payloadDiff` schema doc en `audit-writer.service.ts` JSDoc
  si el nuevo valor cambia las claves esperadas.

## Consequences

### Positive

- **Queries de compliance limpias**: filtrar por `action='chatbot_escalated'`
  no requiere scan en JSON; índices en `(action, created_at)` los cubren.
- **Sub-action enum consistency** entre bundles: todos los owners siguen
  el mismo patrón snake_case + dominio + verbo.
- **Audit del audit reproducible**: la ADR + cheat-sheet en
  DEVELOPER_GUIDE.md previene que un nuevo dev introduzca
  `audit_subaction` o columnas paralelas.
- **Rollback safe**: `IF NOT EXISTS` permite replay; el enum nunca
  pierde valores históricos (forward-compat).

### Negative

- **PG enum cache reload**: cada `ADD VALUE` reconstruye el cache del
  type para todos los workers conectados. Migración consolidada (1/sprint)
  amortiza el costo a 1 reconfig/sprint en lugar de N. Mitigation:
  ya está implícita en la regla "1 migration unificada por sprint".
- **Coordinación overhead**: si 4 bundles necesitan valores y todos
  escriben workaround en iter 1, hay 4 PRs de cleanup en iter 2 (uno
  por bundle migrando su `action: 'create'+subAction` → `action: 'X'`).
  Mitigation: el cleanup es trivial (sed-style replace en service +
  spec), y la deuda se ve en el feed (NEW-FINDING explícito).
- **Cross-sprint debt**: bundles que no alcanzan el iter 2 del sprint
  donde se introduce la migración quedan en backlog Sprint+1. Sprint 4:
  S1 (reports, `report_generated`/`report_downloaded`) + S3 (cron,
  `monthly_report_sent`) + S6 (escalation, `chatbot_escalated`) están
  en este caso. Mitigation: NEW-FINDINGs en S3/S4-iter2 feed flagging
  Sprint 5 como hard deadline.

## Alternatives considered

### A. **Por-bundle migrations** (1 migración por dominio)

Rechazada. N reconfig-PG-enum-cache events por sprint (4 bundles
Sprint 4 → 4 migraciones independientes); más PR review overhead;
mayor probabilidad de naming inconsistencies (cada owner elige sin
context cross-bundle); operación de deploy se rompe si una de las
migraciones falla parcial.

### B. **`audit_subaction` columna paralela**

Rechazada. Duplica responsabilidad con `audit_action`; convierte
queries en compound (`WHERE action='X' AND subaction='Y'`); índice
secundario adicional; rollback complejo (DROP COLUMN sobre tabla
audit_logs con millones de filas).

### C. **Solo `payloadDiff.subAction`** (no extender enum nunca)

Rechazada. Queries de compliance escanean JSON (`payload_diff @>
'{subAction:"chatbot_escalated"}'`); sin functional index GIN
(`audit_logs(payload_diff)`) las queries son O(N); con index, GIN es
write-heavy y duplica I/O del audit log. Performance unacceptable
para reporting mensual.

### D. **String libre (DROP enum, usar `text`)**

Rechazada. Pierde validación a nivel BD; abre la puerta a typos
(`'chatbot_escaled'`) que pasan a producción y rompen reporting;
contradice el principio "BD es la última línea de defensa" del
DEVELOPER_GUIDE §1.

### E. **Migrar a event-sourcing dedicado**

Rechazada (Sprint 4-5). Reescribir audit-log como tabla de eventos
inmutable + projections es ~3 sprints de trabajo; el patrón actual
con `audit_action` + hash chain (Sprint 3 `add_audit_hash_chain`)
cumple los requisitos de compliance sin migración masiva. Sprint 6+
candidate si volumen >1M audit_logs/día.

## Follow-ups (Sprint 5+)

- **Sprint 5**: S1 + S3 + S6 migran sus services del workaround
  `payloadDiff.subAction` a los valores enum nuevos:
  - S1 reports → `action='report_generated'` para PDF/XLSX render +
    `action='report_downloaded'` para descarga (hoy `export_downloaded`,
    que sigue válido pero menos granular).
  - S3 monthly cron → `action='monthly_report_sent'` (hoy `create` +
    `payloadDiff.subAction='sent'|'failed'`).
  - S6 escalation → `action='chatbot_escalated'` (hoy `update` +
    `payloadDiff.subAction='escalated'`).
- **Sprint 5**: agregar PR rule (`SCRIPTS/lint-audit-actions.sh`) que
  detecte `payloadDiff.subAction = '<x>'` donde `<x>` ya es un valor
  válido del enum y warning: "use `action='<x>'` directly".
- **Sprint 5**: actualizar `DEVELOPER_GUIDE.md` §2.5 con el cheat-sheet
  consolidado de valores `audit_action` + matriz dominio→valor.
- **Sprint 6**: query plan review para `audit_logs WHERE action='X'
  AND created_at BETWEEN ...` — si p95 > 100 ms, agregar index
  `(action, created_at desc)` parcial por dominios alta cardinalidad.
- **Sprint 7**: re-evaluar event-sourcing dedicado (alternativa E)
  si volumen audit_logs > 1M/día.
