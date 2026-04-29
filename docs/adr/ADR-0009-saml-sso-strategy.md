# ADR-0009 — SAML SSO strategy (admin federation)

- **Status**: Accepted (Sprint 5 iter 1, 2026-04-28)
- **Authors**: S5-1 (Backend Senior Identity)
- **Refs**: `MVP_08_Seguridad_Cumplimiento_SegurAsist.docx` §IdP federation, `docs/sprint5/DISPATCH_PLAN.md` row S5-1, `prisma/migrations/20260429_tenant_saml_config/`, `src/modules/auth/saml/**`.
- **Trigger**: el cliente MAC pidió que sus admins tenants se autentiquen contra Okta/AzureAD corporativo en vez de mantener una segunda credencial. Sprint 5 incluye SAML SSO + SCIM provisioning como bundle S5-1.

## Context

Tres ejes de decisión se discutieron en el iter 1:

1. **Library** — `samlify` (mantenido, 1.6k stars, MIT) vs `passport-saml`
   (mantenido por node-saml org, más maduro pero el wrapper Passport es
   antinatural en NestJS+Fastify). Opciones tangenciales: `node-saml` raw
   (sin wrapper Passport — la base sobre la que `passport-saml` corre) y
   un parser in-tree.

2. **SP-init vs IdP-init** — ¿soportamos ambos en MVP o solo SP-init?

3. **Tenant config storage** — ¿inflar `Tenant` con columnas SAML o
   crear una tabla 1:1 nueva?

4. **JIT provisioning** — al recibir un assertion para un email que aún
   no existe en `User`, ¿lo creamos automáticamente (just-in-time) o
   requerimos que SCIM lo haya provisionado antes?

## Decision

### 1) Library

**Iter 1 ships con un parser in-tree minimalista** (`SamlService`
implementa decode + signature verify RSA-SHA256 + claim extraction);
**iter 2 sustituye por `samlify`** una vez que SecOps apruebe el bundle
de dependencias transitivas (`xml-crypto` y `xmldom` son los dos puntos
de fricción — históricos CVEs en `xmldom` resueltos en 0.8+, pero
infosec quiere review formal).

Por qué NO `passport-saml` aunque sea el más conocido:

- Passport mismo es un middleware Express; el wrapper para Fastify+Nest
  agrega un layer de adaptación que oscurece el flow del callback.
- El otro service backend (`AuthService` OTP + Cognito) ya NO usa
  Passport — meter Passport solo para SAML rompe consistencia.
- `samlify` expone una API service-style (`sp.parseLoginResponse(...)`)
  que encaja directo con el patrón `Service + Controller` de Nest.

Por qué iter 1 con parser in-tree (no esperar `samlify`):

- El bundle agrega ~300KB y dependencias a auditar; queremos que iter 1
  cierre con la deuda visible y los tests cubiertos.
- El parser in-tree es deliberadamente conservador: rechaza por
  default; toda fricción con un IdP real cae a iter 2 con `samlify`.
- La superficie pública del `SamlService` (`buildLoginUrl`,
  `parseAndValidateAssertion`, `getSpMetadataXml`) NO cambia entre
  iter 1 e iter 2 — el swap es interno.

### 2) SP-init only en MVP

Iter 1 implementa SP-init (`/v1/auth/saml/login?tenantId=...` redirect
al IdP). IdP-init (clic-tile en Okta dashboard que postea directo al
ACS sin AuthnRequest previo) queda **diferido a Sprint 6**.

Razones:

- IdP-init no permite validar `InResponseTo` contra una RelayState
  cookie que NUNCA se generó — el binding al `tenantId` debe venir del
  `RelayState` que el IdP propaga, lo cual depende de cada IdP
  configurarlo. Mayor superficie de error.
- Cliente MAC va a usar el flow desde una landing del portal admin
  (botón "Iniciar con SSO empresarial") — SP-init es el path natural.
- Okta/AzureAD soportan ambos; no perdemos UX en MVP.

### 3) Tenant config storage

**Tabla nueva `tenant_saml_config` 1:1** con FK a `Tenant`:

- `tenants` ya tiene 11 columnas activas + `brandJson` que MT-1 está
  expandiendo para Sprint 5 branding. Agregar 5 columnas SAML inflaría
  el row a 16+ columnas → afecta cache de plan + lecturas list.
- El cert X.509 puede ser >2KB (TEXT en su propia tabla, NO en el row
  Tenant que se carga en cada request del portal).
- Permite revocación granular (`tenant_saml_config.enabled = false` sin
  borrar el row + sin tocar `tenants`).
- RLS de la tabla nueva sigue el patrón canónico tenant-iso (FK a
  `tenants.id` + policy `tenant_id = current_setting('app.current_tenant')`).

Schema (ver `20260429_tenant_saml_config/migration.sql`):

```
tenant_saml_config(
  id UUID PK,
  tenant_id UUID UNIQUE FK→tenants.id,
  idp_entity_id, idp_sso_url, idp_slo_url, idp_metadata_url,
  idp_x509_cert TEXT,
  attribute_map JSONB,
  enabled BOOL
)
```

Mismo patrón para `tenant_scim_config` (token hasheado + flags).

### 4) JIT provisioning vs SCIM-first

**Default: SCIM-first**. Si el IdP postea un assertion para un email
que NO está en `users` para ese tenant, **rechazamos** el login con
`saml.user_not_provisioned` (iter 2). Razones:

- SOC2 / cliente MAC requiere audit trail explícito de "quién creó
  este admin" — JIT difumina la responsabilidad (¿el IdP? ¿el primer
  login?).
- SCIM provee de-provisioning real (DELETE → soft delete + revoke
  session). JIT-only deja huérfanos cuando el IdP elimina al usuario.
- Mapping de roles: el IdP no siempre publica `custom:role`; SCIM lo
  exige en el POST body.

**Excepción opt-in (iter 2)**: cada `tenant_saml_config` puede setear
`jit_provisioning = true` para tenants pequeños sin SCIM activo. Si
está on, el primer login crea el `User` con `role = 'operator'` por
default y queda flag `created_by = 'saml-jit'` en el audit row.

## Consequences

### Positivas

- Iter 1 entrega un flow E2E (metadata → login → ACS → cookie) sin
  depender de aprobación de dependencia externa.
- Tests cubren los 8 paths críticos (signature reject, expiry,
  issuer/tenant mismatch, missing claims, malformed XML).
- La arquitectura admite swap a `samlify` en iter 2 sin tocar
  controllers ni callers.

### Negativas / deuda

- Parser in-tree NO soporta XMLDSig completo (canonicalization
  transforms, exclusive c14n). Funciona con Okta/AzureAD que firman
  el `<Assertion>` directamente con el algoritmo declarado pero
  fallaría con IdPs que requieran transforms exóticos. Iter 2
  resuelve.
- IdP-init deferido — algunos clientes con políticas de "all-IdP-init"
  van a esperar Sprint 6.
- Mock IdP local: `cognito-local` NO implementa SAML (NEW-FINDING-S5-1-01).
  Local dev usa el `MockIdpService` (test fixture) que firma con un
  cert auto-generado; staging usa Okta dev tenant.

## Operational notes

- **Onboarding de un nuevo tenant** → ver `docs/runbooks/RB-019-saml-onboarding.md`.
- **Métricas a monitorear**:
  - `saml.login.success.count{tenantId}`
  - `saml.login.failed.count{tenantId, reason}` — alertar si
    `reason = signature_invalid` >5 en 5min (posible IdP cert rotation
    sin avisar al SP).
  - `saml.assertion.expired.count` (clock skew issue tenant-side).
- **Cert rotation**: cuando el IdP rota su cert, el tenant_admin
  edita `tenant_saml_config.idp_x509_cert` desde
  `/identity/saml`. NO se requiere downtime.

## Links

- Implementación: `segurasist-api/src/modules/auth/saml/`
- Tests: `segurasist-api/test/unit/modules/auth/saml/saml.service.spec.ts`
- Migración: `prisma/migrations/20260429_tenant_saml_config/migration.sql`
- Runbook: `docs/runbooks/RB-019-saml-onboarding.md`
