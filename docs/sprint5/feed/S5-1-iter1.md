# [S5-1 iter 1] 2026-04-28

## Plan

1. SAML SSO admin (SP-init): module + service + controller.
2. SCIM 2.0 user provisioning (Users CRUD + filter + ServiceProviderConfig).
3. Tenant config tables + audit_action enum extension.
4. Admin UI page `/identity/saml`.
5. Tests (12+) — saml.service unit + scim.controller integration.
6. ADR-0009 SAML strategy + RB-019 onboarding runbook.

## Hechos

### Backend SAML

- `src/modules/auth/saml/saml.module.ts` — wired in `AppModule` (post `AuthModule`).
- `src/modules/auth/saml/saml.service.ts`:
  - `getSpMetadataXml()` — SP metadata (entityID, ACS, NameIDFormat,
    `WantAssertionsSigned=true`).
  - `buildLoginUrl(tenant, relayState)` — HTTP-Redirect binding,
    deflated AuthnRequest + RelayState query param.
  - `parseAndValidateAssertion({samlResponseB64, tenant, expectedRelayState, now})`
    — decode, signature verify (RSA-SHA256 against tenant cert), NotBefore /
    NotOnOrAfter ±60s skew, issuer match, InResponseTo match (when present),
    attribute extraction (email / custom:tenant_id / custom:role) with
    per-tenant `attributeMap` override. Throws `UnauthorizedException`
    on every failure path with discriminating reason codes.
  - SHA256 hash of the raw XML (`assertionHashSha256`) returned for
    audit; XML itself NEVER logged (PII rule).
- `src/modules/auth/saml/saml.controller.ts` — `/v1/auth/saml/{metadata,login,acs}`,
  Public + Throttle. RelayState short-lived cookie binds login → ACS
  to the same tenant. ACS sets a placeholder `sa_session` cookie (real
  JWT mint wired in iter 2 once the audit_action enum migration deploys).
- `src/modules/auth/saml/saml.module.ts` imports `AuditPersistenceModule`
  for `AuditContextFactory` request-scoped injection.

### Backend SCIM

- `src/modules/scim/scim.module.ts` wired in `AppModule`.
- `src/modules/scim/scim.service.ts`:
  - In-memory store keyed by `${tenantId}:${userId}`. Iter 2 swaps to
    Prisma. Public surface (`listUsers`, `getUser`, `createUser`,
    `replaceUser`, `patchUser`, `deleteUser`,
    `serviceProviderConfig`) is stable.
  - Idempotency: `externalId` per-tenant unique → 409 on duplicate.
    `userName` per-tenant unique (matches the existing DB constraint
    `users(tenant_id, email)`).
  - Filter parser: `userName eq "..."` and `externalId eq "..."`.
  - PATCH ops: `replace`/`add`/`remove` on `active`, `name.{givenName,
    familyName}`, `emails`, `roles` (+ body-shaped replace fallback).
  - DELETE = soft delete (`deletedAt`, `active=false`).
- `src/modules/scim/scim.controller.ts`:
  - All routes `@Public()` + `@Throttle({ttl:60_000,limit:100})` at the
    controller level.
  - Bearer-token auth resolved from `SCIM_TENANT_TOKENS` env (iter 2:
    `tenant_scim_config.token_hash_sha256`).
  - SCIM error envelope on 401 / 404 / 409.
  - Groups → 404 stub (per dispatch alcance acotado iter 1).

### Migration

- `prisma/migrations/20260429_tenant_saml_config/migration.sql`:
  - `tenant_saml_config` (UUID PK, FK 1:1 `tenants.id`, fields
    `idp_entity_id`, `idp_sso_url`, `idp_slo_url`, `idp_metadata_url`,
    `idp_x509_cert TEXT`, `attribute_map JSONB`, `enabled`).
  - `tenant_scim_config` (UUID PK, FK 1:1, `token_hash_sha256`,
    `token_last_rotated`, `enabled`).
  - RLS habilitado en ambas tablas con policies tenant-iso canónicas
    (`tenant_id = current_setting('app.current_tenant')`).
  - Grants defensivos para `segurasist_app` y `segurasist_admin`.
  - Extiende enum `audit_action` con
    `saml_login_succeeded | saml_login_failed | scim_user_created
    | scim_user_updated | scim_user_deleted` (idempotente con
    `IF NOT EXISTS` en pg_enum lookups).

### Frontend admin

- `apps/admin/app/(app)/identity/saml/page.tsx` — server component,
  RBAC gate (admin_segurasist + admin_mac únicos), form de IdP entityID
  / SSO URL / SLO URL / metadata URL / X.509 cert + botones Guardar +
  Probar conexión + descarga del SP metadata. Markup placeholder
  Lordicons (`<span aria-hidden>...</span>`) listo para swap a `<LordIcon>`
  cuando DS-1 publique el wrapper.

### Tests (12+ combinados)

- `test/unit/modules/auth/saml/saml.service.spec.ts` (11 tests):
  1. parse + validate happy path (claims extracted).
  2. signature reject (different keypair signs assertion).
  3. NotOnOrAfter expired.
  4. NotBefore future.
  5. Issuer mismatch.
  6. Tenant claim mismatch.
  7. Missing email claim.
  8. Tenant not configured (no cert).
  9. SP metadata XML contains entityID + ACS.
  10. buildLoginUrl emits SAMLRequest + RelayState.
  11. Malformed/non-XML payload rejected.
- `test/integration/scim.controller.spec.ts` (11 tests):
  1. 401 without Authorization.
  2. 401 with unknown bearer.
  3. ServiceProviderConfig 200 + capabilities.
  4. POST /Users 201 + SCIM resource shape.
  5. POST /Users dup externalId → 409 uniqueness.
  6. GET /Users filter `userName eq "..."`.
  7. PATCH replace `active=false`.
  8. PUT replace name + email.
  9. DELETE → 204 + subsequent GET 404.
  10. Cross-tenant isolation (token A cannot read tenant B users).
  11. GET /Groups → 404 (iter 1 stub).
- Total: **22 tests** (≥12 minimum).

### Docs

- `docs/adr/ADR-0009-saml-sso-strategy.md` — library decision (iter 1
  parser in-tree, iter 2 swap to `samlify`), SP-init only en MVP,
  table 1:1 `tenant_saml_config`, SCIM-first w/ JIT opt-in iter 2.
- `docs/runbooks/RB-019-saml-onboarding.md` — paso a paso Okta + AzureAD,
  troubleshooting tabla, cert rotation, métricas/alarmas.

## NEW-FINDING

### NEW-FINDING-S5-1-01 — cognito-local NO soporta SAML

`segurasist-infra` local stack usa `cognito-local` que solo emula los
endpoints OAuth/OIDC de Cognito. NO implementa SAML federation. El
docker-compose no expone un IdP SAML.

**Impacto**: el smoke test E2E del flow SAML real no se puede correr
contra local stack. Sin un IdP real, los integration tests del controller
ACS dependerían de un mock-IdP service.

**Mitigación iter 1**: el unit test `saml.service.spec.ts` genera un
keypair RSA, firma el assertion con la priv key y configura la pub key
como `tenant.idpX509Cert` — así cubrimos signature verify, time bounds,
issuer match y claim extraction sin necesitar un IdP externo.

**Recomendación iter 2**:
- Crear `test/fixtures/mock-idp/` que actúe como un mini-IdP HTTP que
  recibe `AuthnRequest`, postea un assertion firmado al ACS, y permite
  E2E del flow completo. Fixture cert auto-generado en `beforeAll`.
- Para staging, usar el Okta dev tenant (gratuito, hasta 5k users) como
  IdP real. Variable env `SAML_TENANT_CONFIGS` ya contempla esto.

### NEW-FINDING-S5-1-02 — `samlify` requiere security review

Iter 1 NO instala `samlify` (ni `passport-saml`) — el parser in-tree
cubre los paths críticos. Iter 2 propone swap a `samlify` pero requiere:

- SecOps review de `xml-crypto` (last CVE 2024) y `xmldom` (last CVE 0.8.x).
- Validar que la versión usada NO corre con `eval` paths al parsear.
- Bundle tamaño ~300KB.

**Recomendación**: incluir `samlify` en el dependency review programado
para iter 2; si no pasa, mantener parser in-tree y solo agregar
`xml-crypto` para XMLDSig completo (transforms, c14n).

### NEW-FINDING-S5-1-03 — audit_action enum requiere migración deploy antes que el wireup

La extensión de `audit_action` (con `saml_login_succeeded` etc) está en
la migración nueva. **El controller iter 1 NO escribe audit log todavía**
(stub `recordAudit` no-op + `audit()` no-op en SCIM). Iter 2 debe:

1. Esperar a que la migration corra en staging.
2. Wirear `AuditWriterService.record({...auditCtx.fromRequest(),
   action: 'saml_login_succeeded'/'saml_login_failed', resourceType:
   'auth.saml', resourceId: tenantId, payloadDiff: {assertionHashSha256, email}})`.
3. Lo mismo para SCIM con `scim_user_{created,updated,deleted}`.

Razón del defer: NO emitir `auditWriter.record` con un valor de enum
que aún no existe en la DB → fail al guardar el row + romper el flow
de login. Esto es el mismo patrón que ADR-0008 documenta para el ciclo
de extensión del enum.

### NEW-FINDING-S5-1-04 — RLS array canónico en `policies.sql` requiere update

`prisma/rls/policies.sql` mantiene un ARRAY canónico de tablas con RLS.
Las dos nuevas (`tenant_saml_config`, `tenant_scim_config`) NO están en
ese array todavía — solo viven en la migración. El `apply-rls.sh`
re-aplicado contra DB nueva omitiría RLS si fall-through al array.

**Acción iter 2**: agregar las dos tablas al array en `policies.sql`
(MT-1 ya tiene cambios en ese archivo para `tenant_branding_assets`;
coordinar consolidación al mergear).

## Bloqueos

- Ninguno crítico para iter 1.
- Permission denied para correr `npx jest` en este worktree (la
  validación de tests cae en el validation gate D5).

## Para iter 2 / cross-cutting

1. **Wirear `AuditWriterService`** en `SamlController.recordAudit` y
   `ScimController.audit` (depende de migration deploy).
2. **Reemplazar parser in-tree por `samlify`** después de SecOps review.
3. **Prisma model + service para `tenant_saml_config`** — actualmente
   `loadTenantConfig` lee `SAML_TENANT_CONFIGS` env (test fixture). Iter 2
   crea `TenantSamlConfigService` con cache 5min y RLS bypass.
4. **Mock IdP fixture** en `test/fixtures/mock-idp/` para E2E completo.
5. **Admin UI proxy routes**: `apps/admin/app/api/admin/saml/{save,test}`
   route handlers que proxean al backend con la cookie `sa_session`.
6. **Update `prisma/rls/policies.sql`** con las dos tablas nuevas.
7. **JIT provisioning toggle** en `tenant_saml_config.jit_provisioning`
   + flow en `SamlController.acs` que crea el `User` row.
8. **Groups CRUD** SCIM (iter 1 stub → 404).
9. **SLO (Single Logout)** SAML — actualmente `idp_slo_url` se persiste
   pero no se consume.

## Resumen entregables

- 3 módulos backend: `SamlModule`, `ScimModule`, migration.
- 1 page frontend: `/identity/saml`.
- 22 tests (objetivo 12 cumplido x1.83).
- 1 ADR (0009).
- 1 runbook (RB-019).
- 4 NEW-FINDINGs documentadas con paths de mitigación.
