# Audit Report — Multi-tenant + RLS + Prisma (A2 — 2da vuelta)

## Resumen

Re-auditoría READ-ONLY tras leer los 9 reportes de pares (`01..10`), el feed
compartido (`_findings-feed.md`, 81 entradas / 68 findings) y vuelta a recorrer
schema/policies/migraciones/clientes Prisma. La 1ra vuelta (`02-multitenant-rls.md`)
ya identificó los 3 issues más serios de A2 (exports fuera de policies.sql, gate
HTTP-layer 23 it.todo, drift `cognitoSub @unique` vs partial index) y el feed
confirma que A3/A5/A6/A9/A10 los referencian como cross-cutting. Esta 2da vuelta
levanta **6 findings nuevos** que sólo aparecen al cruzar mi área con el resto
de los reportes, **confirma 3 patrones convergentes** y **descarta 1 falso
positivo** (no hay ON DELETE CASCADE en relaciones tenant — todas son RESTRICT).

## Findings nuevos (6)

| ID | Severidad | Categoría | Descripción | Ref. cross-cutting |
|---|---|---|---|---|
| **A2v2-01** | High | Pattern / Drift | **3 servicios de aplicación todavía cargan el cast obsoleto `as unknown as Prisma.InsuredWhereInput`** post-migración `20260427_add_insured_cognito_sub`: `insureds.service.ts:673`, `claims.service.ts:82`, `certificates.service.ts:202`. A5-02 sólo reportó 2 (insureds + claims); el de `CertificatesService.urlForSelf` quedó fuera. El `prisma/seed.ts:181,197` ya **NO** lleva el cast (usa `cognitoSub` directo) — la migración SÍ está aplicada, el cast es deuda residual en el resto de servicios. Drift confirmado: schema y seed coherentes; 3 services arrastran el cast. | A1, A4, A5 |
| **A2v2-02** | High | Documentation / Pattern | **`PrismaBypassRlsService` no documenta cuándo SE DEBE usar vs cuándo NO**. El JSDoc (líneas 13-28) lista las reglas de uso pero **no enumera los servicios autorizados** ni el criterio para inyectarlo. El feed muestra que el servicio se inyecta en **16 sitios** (auth, audit, certificates, batches, packages, coverages, insureds, users, tenants, reports, ses-webhook, export-rate-limit guard, bounce-alarm, layout-worker, pdf-worker, insureds-creation-worker, mailpit-tracker, email-worker, reports-worker) — algunos legítimos (workers sin request), otros cuestionables (A1-03 ya reportó que `AuthService` lo inyecta para hacer 2 queries directas que deberían vivir en `InsuredsService`). No existe un ADR ni un comment-style "guard rail" en el service que liste el set autorizado. | A1, A6 |
| **A2v2-03** | High | Test-coverage / Pattern | **`tests/security/cross-tenant.spec.ts` valida nivel BD pero NO valida el modo `bypassRls=true` del PrismaService**. La rama `if (getBypassRls())` (`prisma.service.ts:137-141`) emite warn y devuelve `query(args)` SIN setear tenant — el contrato es "el cliente NOBYPASSRLS devolverá 0 filas". Esa promesa de defensa-en-profundidad NO tiene test integration que valide el path real (hoy sólo unit tests con `mockDeep`). Si alguien refactoriza el branch para pre-set tenant=`'00000000-...'`, queda fuga silenciosa cross-tenant en path superadmin que olvide usar `PrismaBypassRlsService`. | A1, A6 |
| **A2v2-04** | Medium | Test-coverage | **Lista específica de los 23 `it.todo` que SÍ existen en otros e2e vs los que no** (corrige la métrica del feed: A2-04 dijo "varios cubiertos parcialmente"; el inventario real es): cubiertos en `superadmin-cross-tenant.e2e-spec.ts` y `tenant-override.e2e-spec.ts` → 4 ítems del bloque tenant-override + el caso `GET /v1/insureds` filtrado tenant. Cubiertos en `insured-360.e2e-spec.ts` → 1 ítem (`/insureds/:id/360 inexistente → 404` pero NO el específico "id de tenant B"). **NO cubiertos en ningún e2e**: PATCH/DELETE /v1/insureds/:id, GET/POST /v1/batches/:id (any), GET/POST /v1/certificates/:id (any), GET/PATCH /v1/claims/:id, GET /v1/packages/:id, PATCH /v1/coverages/:id, GET /v1/audit/log filtrado por tenant cross-source, GET /v1/chat/{history,kb}, GET /v1/reports/*. Total no cubierto: ~17 endpoints. | A3, A4, A5, A6 |
| **A2v2-05** | Medium | Pattern / Hash inconsistency | **Patrón de hash inconsistente entre dominios**: A4-01 reportó que `Certificate.hash` persiste el `provisionalHash` random, no el SHA-256 del PDF. Verifiqué que el resto de campos hash del schema están bien: `Export.hash` (real SHA-256, `reports-worker.service.ts:275`), `AuditLog.rowHash`/`prevHash` (canonical SHA-256, `audit-hash.ts`). Sólo `Certificate.hash` rompe el contrato. **Convergencia con A6-02**: `recomputeChainOkFromDb` también es un "hash light" (sólo prev_hash, no recomputa SHA). El patrón "hash provisional / hash light" aparece en 2 lugares; ambos comprometen verificación de integridad. Sugiere agregar comments `@invariant: real-SHA-256` a los campos hash del schema y un test cross-cutting que recompute SHA(file) === DB.hash en cada modelo con campo `hash`. | A4, A6 |
| **A2v2-06** | Medium | Idempotency / Retry | **Patrón sistémico de retry inconsistente** que SÍ afecta Prisma: la combinación de A3-31 + A5-01 + A9-04 muestra que `MessageDeduplicationId` se ignora silenciosamente en colas standard. Cuando un cliente hace retry de POST `/insureds/export` o un confirm de batch, **se INSERTA una fila Export/Batch nueva en BD** (UUID generado app-side) y se encolan 2 jobs. En el escenario actual `reports-worker` skip-ea por `status='ready'` (post-procesamiento) pero NO antes; si el primer job aún está `processing`, el 2do duplica trabajo y el 2do `update set status='ready'` puede pisar el resultado. Solución correcta: agregar `UNIQUE (tenant_id, requested_by, kind, hash(filters))` en `exports` (UNIQUE-key idempotency), no depender de SQS dedupe. Mismo patrón aplicable a `batches` (no hay clave de idempotencia natural; podría ser `UNIQUE (tenant_id, file_s3_key)` para impedir doble-confirm del mismo archivo). | A3, A5, A9 |

## Patrones convergentes (confirmados)

### Patrón 1 — `policies.sql` drift (sólo afecta a `exports`)

Verifiqué exhaustivamente las **16 tablas con `tenant_id`** vs el array `tables`
de `policies.sql:49-64`:

- **14 tablas** están en el array y bien cubiertas:
  users, packages, coverages, insureds, beneficiaries, certificates, claims,
  coverage_usage, batches, batch_errors, email_events, chat_messages, chat_kb,
  audit_log.
- **`tenants`** (línea 86-91): RLS deliberadamente NO aplicado (es el catálogo);
  REVOKE de mutaciones a `segurasist_app` + GRANT SELECT — correcto.
- **`system_alerts`** (migración `20260428`, schema:518): NO tiene RLS, doc inline
  dice "alertas globales SegurAsist; si se vuelve tenant-only, agregar policy
  similar". Aceptable por diseño.
- **`exports`** (migración `20260427_add_exports_table`, schema:588): RLS sólo
  en la migración, NO en `policies.sql`. **Único drift real** — confirma A2-01
  como el único caso. La hipótesis del re-revision ("¿hay otras tablas?") queda
  descartada.

**Conclusión**: el patrón `policies.sql` drift es de UNA tabla. La recomendación
A2-08 (descubrimiento dinámico vía `information_schema.columns WHERE column_name='tenant_id'`)
sigue siendo válida como prevención forward-looking.

### Patrón 2 — `PrismaBypassRlsService` sin guard rails

`auth.service.ts` (A1-03), `audit.service.ts`, `bounce-alarm.service.ts`,
`ses-webhook.controller.ts`, `export-rate-limit.guard.ts` lo inyectan directo
para queries cross-tenant **legítimas** pero sin documentación central. Pareciera
no haber un criterio único:

- Workers (sin `req`): legítimo (no hay tenant en runtime).
- Webhook SES (sin auth): legítimo (SNS no aporta tenant).
- AuthService.findInsuredByCurp: cuestionable (A1-03 propone moverlo a InsuredsService).
- Audit/BounceAlarm/Tenants: legítimo (operación cross-tenant intencional).
- Insureds/Reports/Coverages/Packages/Batches/Users: usan el patrón polimórfico
  `platformAdmin ? this.prismaBypass.client : this.prisma.client` — **legítimo
  pero con riesgo de lectura accidental**: si el caller marca `platformAdmin=true`
  sin haber pasado por `RolesGuard`, abre la fuga. El JwtAuthGuard sí lo enforza
  pero un test que inyecta el service sin pasar por los guards puede romperlo.

**Conclusión**: convergente con A1-03 + A2v2-02. Recomendación: ADR-XXX
"PrismaBypassRlsService usage matrix" + helper `BypassClientFactory.forSuperadmin(user)`
que enforce `assertPlatformAdmin(user)` antes de devolver el client.

### Patrón 3 — schema/migration drift `cognitoSub` (estado actual)

El schema declara `cognitoSub String? @unique` (`schema.prisma:301`). La migración
crea `CREATE UNIQUE INDEX ... WHERE cognito_sub IS NOT NULL` (partial index).
Verifiqué:

- **Seed** (`prisma/seed.ts:179-201`): usa `cognitoSub: insuredCognitoSub` directo,
  sin cast. **Sincronizado**.
- **Servicios consumidores** (3): `insureds.service.ts:673`, `claims.service.ts:82`,
  `certificates.service.ts:202` arrastran `as unknown as Prisma.InsuredWhereInput`.
  **NO sincronizado** (issue A2v2-01).
- **Schema vs migración**: `prisma migrate diff` no fue corrido por la auditoría,
  pero el divorcio sigue presente. Cuando un dev haga `prisma migrate dev --create-only`
  con un cambio futuro, podría intentar reconciliar el index partial → constraint
  plano (regresión silenciosa).

**Conclusión**: sincronización seed=schema (OK), services pendientes (3 sitios),
drift schema↔migration sigue como issue A2-03 (no resuelto).

## Re-leer código — hallazgos puntuales

### `prisma/schema.prisma` — relaciones cross-tenant

Verifiqué las 26 relaciones FK. **Ninguna usa CASCADE para `ON DELETE`** — todas
son `RESTRICT` (init_schema:415-478). Esto significa:

- Borrar un tenant NO cascadea borra users/insureds/etc → no hay riesgo de
  orphan rows cross-tenant via cascade.
- Pero también significa: **soft-delete tenant** (`deletedAt != NULL`) NO
  propaga a hijos; queries por tenantId siguen viendo data "viva" del tenant
  inactivo. (Este NO es un bug de RLS — es un trade-off de soft-delete; mantener
  como nota de UX/clarity.)

`Tenant.exports` (relation virtual en schema.prisma:206) está declarada pero
ESTÁ presente como FK en la migración (`exports_tenant_fk`). **Sin issues**.

### `prisma/rls/policies.sql` vs migraciones — drift detallado

Cubierto en Patrón 1 arriba. Único drift = `exports`.

### `apply-rls.sh` — idempotencia para `exports`

**No es idempotente para `exports`**: `apply-rls.sh` re-ejecuta `policies.sql`,
que NO menciona `exports`. Si la BD se acaba de bootstrapear (migrate deploy
incluyó `add_exports_table`, que SÍ creó las policies), `apply-rls.sh` no
afecta `exports` (las policies se mantienen). Pero si las policies de `exports`
se dropean manualmente o se hace `DROP TABLE exports CASCADE`+recrea sin
re-correr la migración, `apply-rls.sh` NO las restaura. Confirma A2-01 desde
otro ángulo.

### `PrismaBypassRlsService` — documentación de uso

Las reglas (líneas 20-28) dicen "DEBE verificar `req.user.role === 'admin_segurasist'`
ANTES de llamar a métodos de este service" — pero **no proveen un mecanismo para
enforce esa precondición**. El service se inyecta como singleton (Scope.DEFAULT)
y cualquier consumidor puede llamar `client.X.findMany()` sin que un assertion
salte. Issue A2v2-02.

## Verificación cross-tenant tests

### 7 tests reales — qué blindan

| Test | SELECT | INSERT | UPDATE | DELETE |
|---|:---:|:---:|:---:|:---:|
| `app role sin SET LOCAL devuelve 0 filas` | ✅ | — | — | — |
| `SET LOCAL=A ve sólo insureds de A` | ✅ | — | — | — |
| `SET LOCAL=A NO puede leer insureds de B por id` | ✅ | — | — | — |
| `S3-06 find360 cross-tenant` | ✅ | — | — | — |
| `INSERT en tenant B context=A → WITH CHECK falla` | — | ✅ | — | — |
| `superadmin BYPASSRLS ve A y B` | ✅ | — | — | — |
| `cliente NOBYPASSRLS sin SET → 0 filas` | ✅ | — | — | — |

**SELECT cubierto 5×, INSERT cubierto 1×. UPDATE 0×, DELETE 0×**. Confirma
A2-02 ("UPDATE/DELETE cross-tenant no testeados directamente"). La policy `FOR ALL`
los cubre a nivel DB, pero el gate de PR no detecta una regresión que cambie
la policy.

### 23 `it.todo` HTTP-layer — qué SÍ está cubierto en otros e2e (A2v2-04)

| `it.todo` | Cubierto en | Estado |
|---|---|---|
| `GET /v1/insureds — sólo del tenant A` | `superadmin-cross-tenant.e2e-spec.ts:106` | parcial (path superadmin filtrado, no es exactamente el test pero valida el RLS) |
| `GET /v1/insureds/:id (id de B) → 404` | (ningún e2e) | **NO** |
| `GET /v1/insureds/:id/360 (id de B) → 404` | `insured-360.e2e-spec.ts:171` | parcial (id inexistente, no exactamente "id de B") |
| `PATCH/DELETE /v1/insureds/:id (id de B) → 404` | (ninguno) | **NO** |
| `GET/POST /v1/batches/:id (id de B)` | (ninguno) | **NO** |
| `GET/POST /v1/certificates/:id (id de B)` | `certificates.e2e-spec.ts:73` (id inexistente) | parcial |
| `GET/PATCH /v1/claims/:id (id de B) → 404` | (ninguno) | **NO** |
| `GET /v1/packages/:id, PATCH /v1/coverages/:id (id de B)` | (ninguno) | **NO** |
| `GET /v1/audit/log — sólo entradas de A` | `audit-log.e2e-spec.ts` (sin cross-tenant explícito) | **NO** |
| `GET /v1/chat/history, /v1/chat/kb` | (ninguno) | **NO** |
| `GET /v1/reports/*` | (ninguno) | **NO** |
| `tenant-override` (4 ítems S3-08) | `tenant-override.e2e-spec.ts:139,154,163,173` | **SÍ** (4/4 cubiertos) |

**Resumen**: ~4 de 23 cubiertos en otros e2e con casos directamente equivalentes;
~3 cubiertos parcialmente (id inexistente, no específicamente "id de tenant B");
~16 ítems sin cobertura demostrable. Refina A2-04.

## Reconciliación con la 1ra vuelta

| Issue 1ra vuelta | Estado en 2da vuelta |
|---|---|
| A2-01 (exports drift) | **Confirmado**, único caso. Hipótesis "otras tablas" descartada. |
| A2-02 (UPDATE/DELETE no testeados) | **Confirmado** con tabla. |
| A2-03 (cognitoSub schema/migration drift) | **Confirmado**. Seed sincronizado, 3 services con cast obsoleto (issue nuevo A2v2-01). |
| A2-04 (23 it.todo) | **Refinado** con tabla detallada (A2v2-04): ~4 cubiertos, ~16 sin cobertura. |
| A2-05 (password placeholder) | **Sin cambios**. |
| A2-06 (request-scoped Prisma cost) | **Sin cambios**. |
| A2-07..10 (low) | **Sin cambios**. |
| (nuevo) A2v2-01 | Cast obsoleto en 3 servicios |
| (nuevo) A2v2-02 | PrismaBypassRlsService sin doc/enforce de uso |
| (nuevo) A2v2-03 | bypassRls=true path sin test integration |
| (nuevo) A2v2-04 | Inventario detallado 23 it.todo |
| (nuevo) A2v2-05 | Patrón hash inconsistente (cert + audit-light) |
| (nuevo) A2v2-06 | Idempotencia retry — solución BD, no SQS |

## Cross-cutting (append al feed)

```
[A2-v2] 2026-04-25 22:30 High insureds.service.ts:673 + claims.service.ts:82 + certificates.service.ts:202 — `as unknown as Prisma.InsuredWhereInput` cast obsoleto post-migración cognito_sub en 3 servicios; seed ya está sincronizado. // A1/A4/A5: limpieza pura.
[A2-v2] 2026-04-25 22:30 High prisma-bypass-rls.service.ts (entero) — sin documentación que enumere servicios autorizados ni helper assertPlatformAdmin(user) que enforce. 16 inyecciones, no hay guard rail. // A1/A6.
[A2-v2] 2026-04-25 22:30 High prisma.service.ts:137-141 — branch bypassRls=true sin test integration que valide "NOBYPASSRLS devuelve 0 filas". // A1/A6 defensa en profundidad sin gate de PR.
[A2-v2] 2026-04-25 22:30 Medium test/security/cross-tenant.spec.ts:241-287 — 16 de 23 it.todo HTTP-layer no cubiertos en NINGÚN e2e (refinamiento de A2-04). // A3/A4/A5/A6.
[A2-v2] 2026-04-25 22:30 Medium Certificate.hash (schema) y AuditLog.recomputeChainOkFromDb — patrón "hash light/provisional" rompe verificación de integridad en 2 dominios. // A4/A6.
[A2-v2] 2026-04-25 22:30 Medium exports + batches — falta UNIQUE de idempotency BD-side; depender de SQS dedupe en cola standard es no-op. // A3/A5/A9.
```

## Recomendaciones Sprint 4 (priorizadas)

1. **A2v2-01 (High, quick win)**: eliminar el cast `as unknown as Prisma.InsuredWhereInput`
   en los 3 servicios (1-line fix cada uno; ya hay seed que demuestra que la
   migración aplicó).
2. **A2v2-02 (High, medio plazo)**: redactar ADR-XXX "PrismaBypassRlsService
   usage matrix" + helper `BypassClientFactory.forSuperadmin(user: AuthUser)`
   con `assertPlatformAdmin` interno. Reemplazar las 16 inyecciones directas.
3. **A2v2-03 (High)**: agregar test integration en `cross-tenant.spec.ts` que
   simule `bypassRls=true` con cliente normal y verifique 0 filas
   (defensa-en-profundidad). Mantiene el contrato del comment de `prisma.service.ts:137-141`.
4. **A2v2-06 (Medium)**: agregar `UNIQUE (tenant_id, requested_by, kind, sha256(filters))`
   en `exports` y `UNIQUE (tenant_id, file_s3_key)` en `batches` para idempotency
   BD-side. Cierra el gap conjunto A3-03 + A5-01 + A9-09 sin necesidad de FIFO.
5. **A2v2-05 (Medium)**: agregar comments `@invariant: real SHA-256` en los campos
   hash del schema (Certificate.hash, Export.hash, AuditLog.rowHash) y un test
   cross-cutting `hash-integrity.spec.ts` que recompute SHA(content) === DB.hash
   por modelo. Resuelve el gap detección A4-01 + A6-02 sistémicamente.
6. **A2v2-04 (Medium)**: implementar al menos los 5 endpoints más críticos del
   inventario no cubierto (`PATCH/DELETE /v1/insureds/:id`, `POST /v1/batches/:id/confirm`,
   `PATCH /v1/claims/:id`, `GET /v1/audit/log` cross-source, `PATCH /v1/coverages/:id`).
