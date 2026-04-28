# Audit Report — Multi-tenant + RLS + Prisma (A2)

## Summary (≤10 líneas)

El núcleo multi-tenant es robusto: `PrismaService` request-scoped resuelve el bug
Sprint 2 con lectura LAZY de `req.tenant`, parametriza `set_config` vía
`Prisma.sql`, valida formato UUID antes de SET, y empaqueta cada operación de
modelo dentro de una transacción para garantizar pareo conexión SET ↔ query. La
defensa en profundidad superadmin (rol DB `segurasist_app` NOBYPASSRLS + cliente
separado `PrismaBypassRlsService` con `segurasist_admin` BYPASSRLS) está bien
diseñada y los services superadmin lo respetan consistentemente. Las policies
RLS cubren `USING + WITH CHECK` (vía `FOR ALL`) en 14 tablas tenant-scoped. La
migración `superadmin_nullable_tenant` instala el CHECK constraint correcto y
`add_insured_cognito_sub` crea el partial UNIQUE index correcto en BD. Issues
principales: el gate de PR (cross-tenant.spec.ts) blinda SELECT + INSERT pero
NO ejercita explícitamente UPDATE/DELETE; la tabla `exports` lleva sus policies
sólo en su migración (no en `policies.sql`), rompiendo el contrato "policies.sql
re-aplicable como source of truth"; el schema Prisma declara `cognitoSub @unique`
mientras la migración crea un partial-unique → posible drift en `prisma migrate
diff` futuro.

## Files audited

12 archivos:

- `segurasist-api/src/common/prisma/prisma.service.ts` (177 líneas).
- `segurasist-api/src/common/prisma/prisma-bypass-rls.service.ts` (79 líneas).
- `segurasist-api/src/common/prisma/prisma.module.ts`.
- `segurasist-api/src/common/prisma/prisma.service.spec.ts` (225 líneas).
- `segurasist-api/prisma/schema.prisma` (614 líneas, 17 modelos).
- `segurasist-api/prisma/rls/policies.sql` (97 líneas).
- `segurasist-api/scripts/apply-rls.sh`.
- `segurasist-api/prisma/migrations/20260425_init_schema/migration.sql`.
- `segurasist-api/prisma/migrations/20260426_superadmin_nullable_tenant/migration.sql`.
- `segurasist-api/prisma/migrations/20260426_audit_log_mirror_flag/migration.sql`.
- `segurasist-api/prisma/migrations/20260427_add_insured_cognito_sub/migration.sql`.
- `segurasist-api/prisma/migrations/20260427_add_exports_table/migration.sql`.
- `segurasist-api/prisma/migrations/20260427_add_audit_hash_chain/migration.sql`.
- `segurasist-api/prisma/migrations/20260426_insureds_search_indexes/migration.sql`.
- `segurasist-api/prisma/migrations/20260428_add_system_alerts/migration.sql`.
- `segurasist-api/test/security/cross-tenant.spec.ts` (288 líneas, 7 tests reales + 23 `it.todo`).
- `segurasist-api/test/e2e/superadmin-cross-tenant.e2e-spec.ts`.
- `segurasist-api/test/integration/verify-chain-cross-source.spec.ts`.
- Verificación cruzada en consumidores: `tenants.service.ts`, `webhooks/ses-webhook.controller.ts`, `workers/*` (4), `modules/insureds/*`, `modules/coverages/*`, `modules/packages/*`, `modules/batches/*`, `modules/audit/audit.service.ts`, `audit-writer.service.ts`, `audit-s3-mirror.service.ts`, `auth/auth.service.ts`, `users/users.service.ts`, `reports/reports.service.ts`.

## Strengths

- Lectura LAZY de `req.tenant` y `req.bypassRls` (fix Sprint 2):
  `prisma.service.ts:55-69` resuelve el bug de timing NestJS request-scoped vs
  guards. El comentario es exhaustivo.
- Pareo SET + query en MISMA transacción, vía `$extends.query.$allOperations`
  re-despachando contra `tx[model][op]`: garantiza que `app.current_tenant`
  comparte conexión con la query principal (`prisma.service.ts:146-166`).
- `Prisma.sql\`SELECT set_config(..., ${tenantId}, true)\`` parametrizado:
  `prisma.service.ts:103,148`. Cero superficie de SQL injection.
- Validación UUID format antes de SET: `prisma.service.ts:108-113`. Defensa en
  profundidad redundante (Prisma.sql ya parameteriza), pero correcta.
- Guard explícito en `withTenant`: si `bypassRls=true` lanza `ForbiddenException`
  forzando uso de `PrismaBypassRlsService` (`prisma.service.ts:93-99`).
- `PrismaBypassRlsService.client` getter lanza si `DATABASE_URL_BYPASS` no está
  configurada (`prisma-bypass-rls.service.ts:69-74`): falla limpia en lugar de
  leer con NOBYPASSRLS sin tenant context (que devolvería listas vacías y
  ocultaría el bug).
- Policy SQL idempotente con `DROP POLICY IF EXISTS` + recreate
  (`policies.sql:70-82`) y roles creados con `IF NOT EXISTS` (`policies.sql:17-22`).
- `FORCE ROW LEVEL SECURITY` aplicado a cada tabla (`policies.sql:68`): RLS
  aplica incluso al owner de la tabla, evitando footgun común.
- Policy `FOR ALL` con `USING + WITH CHECK` cubre SELECT/INSERT/UPDATE/DELETE en
  una sola política (`policies.sql:76-82`). WITH CHECK previene cross-tenant
  INSERT/UPDATE.
- Migración `superadmin_nullable_tenant` instala el CHECK constraint correcto:
  sólo `admin_segurasist` puede tener `tenant_id NULL` a nivel BD
  (`20260426_superadmin_nullable_tenant/migration.sql:30-36`).
- `audit_log_mirror_flag` agrega un partial index sobre `mirrored_to_s3=false`
  para optimizar el worker sin pagar costo en filas mirroreadas
  (`20260426_audit_log_mirror_flag/migration.sql:24-26`).
- `add_insured_cognito_sub` correctamente usa **partial UNIQUE index** `WHERE
  cognito_sub IS NOT NULL` (`20260427_add_insured_cognito_sub/migration.sql:10-11`),
  permitiendo múltiples inserts pre-OTP con `cognitoSub=NULL`.
- `apply-rls.sh` es idempotente (puede ejecutarse N veces, `policies.sql` es
  drop+recreate). Sanity check al final lista los roles presentes
  (`apply-rls.sh:46-48`).
- Convention `@map("snake_case")` aplicada en TODOS los modelos. Enums llevan
  `@@map` correctamente. 148 directivas `@map` en schema.
- Comentarios `///` Prisma exhaustivos en campos no obvios: `User.tenantId`
  (CHECK constraint), `Insured.cognitoSub` (lifecycle OTP), `Export.*` (lifecycle
  + anti-abuso), `AuditLog.prevHash/rowHash/mirroredToS3` (hash chain).
- Tests cross-tenant cubren superadmin BYPASS, defense-in-depth NOBYPASSRLS sin
  SET, y la matriz HTTP-layer completa como `it.todo` (23 endpoints listados,
  scope explícito).
- Workers (`reports-worker`, `email-worker`, `mailpit-tracker`,
  `insureds-creation-worker`) **siempre** usan `PrismaBypassRlsService`. Cero
  uso de `PrismaService` en background jobs (que no tienen request → no tendrían
  tenant context).
- Raw queries (`reports.service.ts:291,297,303`,
  `insureds-creation-worker.ts:207`, `audit-writer.service.ts:173`) usan
  `Prisma.sql\`...${param}...\`` con parametrización correcta.
- Controllers que aceptan `?tenantId=` aplican el patrón consistente
  `platformAdmin ? queryTenantId : req.tenant?.id` en `buildScope`
  (`insureds.controller.ts:49-58`, `coverages.controller.ts:68-73`). El query
  param se ignora silenciosamente para roles no-superadmin (RLS lo enforza
  igualmente).

## Issues found

| ID | File:line | Severity | Category | Description | Recommendation |
|---|---|---|---|---|---|
| A2-01 | `prisma/rls/policies.sql:49-64` y `prisma/migrations/20260427_add_exports_table/migration.sql:51-63` | High | Maintainability | La tabla `exports` tiene RLS policies SOLO en su migración; NO está en el array `tables` de `policies.sql`. Si un dev ejecuta `apply-rls.sh` contra una BD recién creada (donde aún no corrió `migrate deploy`), `exports` no tendrá policies. Inversamente, si las policies se dropean manualmente, re-correr `policies.sql` no las restaurará. Rompe el contrato "policies.sql es la source of truth re-ejecutable". | Agregar `'exports'` al array `tables` en `policies.sql:49-64`. La migración puede dejarse para forward-only state, pero `apply-rls.sh` debe poder reconstruir el estado completo. |
| A2-02 | `test/security/cross-tenant.spec.ts:110-235` | High | Test-coverage | Los 7 tests reales blindan SELECT (×4) e INSERT (×1). NO hay test explícito para UPDATE ni DELETE cross-tenant. La policy `FOR ALL` cubre todas las ops a nivel DB, pero el gate de PR no detecta una eventual regresión que cambie la policy a `FOR SELECT, INSERT`. | Agregar 2 tests: (a) `app role context=A intenta UPDATE insured de B → cambia 0 filas / falla WITH CHECK`. (b) `... DELETE insured de B → cambia 0 filas`. |
| A2-03 | `prisma/schema.prisma:301` vs `prisma/migrations/20260427_add_insured_cognito_sub/migration.sql:10-11` | Medium | Pattern / DX | El schema declara `cognitoSub String? @unique` (genera UNIQUE constraint plano sobre la columna, NULLs distintos en Postgres por defecto pero el comportamiento difiere de un partial index). La migración crea un **partial UNIQUE index** `WHERE cognito_sub IS NOT NULL`. `prisma migrate diff` futuro contra el schema podría intentar "reconciliar" creando un constraint plano duplicado o eliminando el partial. | Documentar el divorcio explícitamente con un `@map("insureds_cognito_sub_key")` en el schema y/o mover el constraint a `extendedIndexes`/raw SQL en una migración custom protegida con `// prisma-ignore`. Validar con `prisma migrate diff` en CI que no genera output. |
| A2-04 | `test/security/cross-tenant.spec.ts:241-287` | Medium | Test-coverage | 23 `it.todo` declaran la matriz HTTP-layer pero NUNCA se implementan en este spec. Algunos están cubiertos parcialmente en e2e externos (e.g. `superadmin-cross-tenant.e2e-spec.ts`, `tenant-override.e2e-spec.ts`, `insured-360.e2e-spec.ts`) pero la mayoría (DELETE/PATCH cross-tenant para insureds, batches, certificates, claims; chat history; reports; audit log) carecen de cobertura demostrable. | Inventariar cuáles `it.todo` están realmente cubiertos en otros e2e (lookup por `404` cross-tenant) y migrar el resto a tests reales o eliminar el `it.todo` si no aplica al MVP. Endpoints sin cobertura probable: `PATCH/DELETE /v1/insureds/:id`, `POST /v1/batches/:id/confirm`, `PATCH /v1/claims/:id`, `PATCH /v1/coverages/:id`, `GET /v1/audit/log`, `GET /v1/chat/history`, `GET /v1/reports/*`. |
| A2-05 | `prisma/rls/policies.sql:18,22` y `.env.example:22,25` y `test/security/cross-tenant.spec.ts:23,26` | Medium | Security | Password `'CHANGE_ME_IN_SECRETS_MANAGER'` hardcodeada como literal en `policies.sql` y referenciada en `.env.example` y en el spec. En dev local "CHANGE_ME_IN_SECRETS_MANAGER" ES la password real, lo cual está bien para localhost, pero hace de placeholder un valor "real" que puede sobrevivir en staging/prod si alguien ejecuta `apply-rls.sh` sin overrides. La migración no rota la password en re-runs (idempotente sólo con `IF NOT EXISTS`). | Cambiar `policies.sql` a `CREATE ROLE ... LOGIN` sin PASSWORD (set vía `\password` o variable `PGAPP_PASSWORD` interpolada por el script). Documentar en `apply-rls.sh` que en prod la password debe inyectarse desde Secrets Manager y NUNCA usar el placeholder. |
| A2-06 | `prisma.service.ts:62,63` | Low | Pattern | El constructor instancia `new PrismaClient(...)` por cada request (`Scope.REQUEST`). Cada request abre su propio pool en `onModuleInit` y lo cierra en `onModuleDestroy`. Bajo tráfico real esto es costoso (TCP handshake + pool init por request). Prisma típicamente recomienda compartir el `PrismaClient` y usar `$extends` por contexto. | Compartir un `PrismaClient` root (no request-scoped) y aplicar el `$extends` en un wrapper request-scoped que sólo capture el `req`. El `$extends` ya soporta closure sobre tenant. Validar con un load test (k6 o autocannon) impacto p95 antes/después. Ojo: cualquier cambio aquí debe re-pasar el test integration `tenant-override.spec.ts` y los e2e M2. |
| A2-07 | `prisma.service.ts:115-170` | Low | Maintainability | El re-despacho manual `txClient[lowerFirst(model)][operation]` (líneas 153-166) reimplementa lógica que Prisma ya hace internamente. Si Prisma agrega nuevos tipos de operación (futuro `$createMany`, etc.), el wrapper romperá silenciosamente con `operación desconocida`. La función `lowerFirst` también es frágil para PascalCase compuestos (no aplica al schema actual, pero documental). | Mantener cobertura unit test para esta ruta (`prisma.service.spec.ts:205-223` ya incluye `modelo desconocido` y `operación desconocida`). Considerar usar `query(args)` directamente cuando Prisma exponga un client transaccional via `tx` en `query` en una versión futura. |
| A2-08 | `prisma/rls/policies.sql:49-64` | Low | Maintainability | La lista de tablas tenant-scoped está hardcodeada como array literal. Cada nuevo modelo con `tenant_id` requiere edición manual de esta lista (riesgo de olvido). El reciente caso `exports` es exactamente este escenario (ver A2-01). | Reemplazar por un `SELECT ... FROM information_schema.columns WHERE column_name='tenant_id'` que descubra dinámicamente las tablas y aplique el helper. Excluir explícitamente `tenants` y `system_alerts` (ya documentado en comentarios). |
| A2-09 | `prisma.service.ts:46` y `prisma.service.spec.ts` | Low | Test-coverage | El test unit usa un `PrismaClient` mockeado completo y testea el callback `$extends.query.$allOperations` extrayendo el config con `(this as ...).__extendsCfg`. Fragmenta la verificación contra la implementación interna de `$extends`. Si Prisma cambia la forma de `$extends` (e.g. aplica el wrapper inmediatamente sin guardar config), los tests rompen sin que haya regresión real. | Agregar un test integration que use Postgres real + `apply-rls.sh` para verificar que el SET realmente populó `app.current_tenant` en `pg_stat_activity` o vía un trigger de prueba. Mantiene el unit test pero baja la dependencia con la API interna. |
| A2-10 | `audit-writer.service.ts:100-122` y `audit-s3-mirror.service.ts:78-95` | Low | Structure | El audit subsystem instancia su propio `PrismaClient` (vía `DATABASE_URL_AUDIT`), totalmente separado de `PrismaService` y `PrismaBypassRlsService`. Es una tercera vía Prisma → BD, intencional para aislar el writer de audit (defensa en profundidad: si la app DB cae, el audit log puede vivir en otra réplica), pero documenta superficie adicional de mantenimiento. | OK por diseño. Documentar en `docs/audit/AUDIT_INDEX.md` la existencia de los 3 clients Prisma (request-scoped, bypass, audit) con su matriz de uso. Validar en env.schema que `DATABASE_URL_AUDIT` puede colocarse en una réplica/cluster distinto. |

## Cross-cutting concerns (afectan a otras áreas)

Append al `_findings-feed.md`:

```
[A2] 2026-04-25 — High — segurasist-api/test/security/cross-tenant.spec.ts:241-287 — 23 it.todo HTTP-layer no implementados; varios endpoints (PATCH/DELETE /v1/insureds/:id, POST /v1/batches/:id/confirm, GET /v1/reports/*) no tienen blindaje de PR cross-tenant directo // impacta A3 (batches), A4 (certificates), A5 (insureds, reports), A6 (audit/throttler).
[A2] 2026-04-25 — High — segurasist-api/prisma/rls/policies.sql:49-64 — tabla exports NO está en el array tenant-iso de policies.sql (sólo en su migración) // impacta A5 (reports/exports) y A9 (DevOps: re-aplicar policies.sql contra DB nueva omite exports).
[A2] 2026-04-25 — Medium — segurasist-api/prisma/schema.prisma:301 — drift entre @unique de schema y partial UNIQUE index real en BD // impacta A10 (DX: prisma migrate diff podría generar drift en CI).
```

## Recommendations Sprint 4

1. **Cerrar el gate cross-tenant**: agregar 2 tests reales para UPDATE/DELETE
   en `cross-tenant.spec.ts` (issue A2-02) e implementar al menos los 5
   endpoints HTTP-layer más críticos (`PATCH/DELETE /v1/insureds/:id`,
   `POST /v1/batches/:id/confirm`, `PATCH /v1/claims/:id`, `GET /v1/audit/log`,
   `PATCH /v1/coverages/:id`) — issue A2-04.
2. **Reconciliar exports en `policies.sql`**: agregar `'exports'` al array
   tenant-iso (issue A2-01). En el mismo PR, considerar la propuesta de A2-08
   (descubrimiento dinámico de tablas con `tenant_id`).
3. **Resolver schema/migration drift en `Insured.cognitoSub`** (issue A2-03):
   asegurar que `prisma migrate diff` en CI no genera diferencias contra el
   estado de la BD post-migración. Documentar la decisión en un ADR si se
   mantiene divergente.
4. **Rotar password placeholder** (issue A2-05): mover la creación de roles
   con password a un step separado que tome la password de Secrets Manager,
   dejando `policies.sql` sin literal de password.
5. **Performance load test del PrismaService request-scoped** (issue A2-06):
   validar p95 con 100 RPS sostenidos antes de commit-to-prod. Si hay impacto
   significativo, refactor al patrón shared root + `$extends` request-scoped.
