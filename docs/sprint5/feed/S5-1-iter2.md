# [S5-1 iter 2] 2026-04-28

**Owner**: S5-1 (SAML / SCIM identity federation)
**Estado**: COMPLETE
**Cierre Sprint 5** — closes CC-06, CC-11, CC-16, CC-17.

## Plan iter 2

1. CC-06 — mock IdP fixtures bajo `test/fixtures/mock-idp/`.
2. CC-11 — charset SAML metadata `application/samlmetadata+xml; charset=UTF-8`.
3. CC-16 — wireup `AuditWriterService.record(...)` en SAML + SCIM.
4. CC-17 — `policies.sql` array añadir `tenant_saml_config` + `tenant_scim_config`.
5. Stub E2E (`it.skip`) bajo `test/e2e/saml-flow.spec.ts` con TODO Sprint 6.
6. Reporte feed.

## Hechos

### CC-06 — Mock IdP fixtures (E2E groundwork)

- `segurasist-api/test/fixtures/mock-idp/README.md` — security warning (test-only),
  uso desde Jest `beforeAll`, follow-ups Sprint 6 (Okta dev tenant).
- `segurasist-api/test/fixtures/mock-idp/keys/.gitignore` — gitignora
  `idp-private.pem`, `idp-public.pem` y el sufijo `.local.pem` (regla dispatch).
- `segurasist-api/test/fixtures/mock-idp/keys/generate-keys.mjs` — generador
  idempotente RSA 2048 (`crypto.generateKeyPairSync`). Escribe pkcs8 (`idp-private.pem`)
  + spki (`idp-public.pem`) + mirrors `.local.pem`. Importable como
  `import { ensureKeypair } from '.../generate-keys.mjs'` o ejecutable CLI.
- `segurasist-api/test/fixtures/mock-idp/assertion-template.xml` — `<samlp:Response>`
  válido con placeholders `{{tenantId}}`, `{{email}}`, `{{notOnOrAfter}}`,
  `{{notBefore}}`, `{{nameId}}`, `{{issuer}}`, `{{role}}`, `{{inResponseTo}}`,
  `{{signatureValue}}`. Incluye `<saml:Conditions>` con `<saml:AudienceRestriction>`,
  `<saml:AuthnStatement>` y `<saml:AttributeStatement>` con email + tenant_id + role.
- `segurasist-api/test/fixtures/mock-idp/sign-assertion.ts` — helper TS que toma
  `{values, templatePath?, privateKeyPath?}`, sustituye placeholders, firma el bloque
  `<saml:Assertion>` con RSA-SHA256, devuelve la base64 del `<samlp:Response>` lista
  para POST a `/v1/auth/saml/acs`.
- `segurasist-api/test/e2e/saml-flow.spec.ts` — 3 stubs `it.skip` con TODO Sprint 6:
  (a) full SP-init flow contra mock IdP, (b) tampered signature → audit fail,
  (c) Playwright happy path contra Okta dev tenant.

**No keys committed**: `generate-keys.mjs` corre en `beforeAll` o en CI antes de la
suite E2E. La regla "fixtures keypair: privadas a /test/fixtures, gitignored si
tienen sufijo `.local.pem`" se respeta — el `.gitignore` adyacente cubre los cuatro
nombres.

### CC-11 — Charset SAML metadata

- `segurasist-api/src/modules/auth/saml/saml.controller.ts:73-79` — el header pasó
  de `application/samlmetadata+xml; charset=utf-8` (lowercase) a
  `application/samlmetadata+xml; charset=UTF-8` (RFC 7580 §3 + UTF-8 canonical
  spelling). JSDoc cita la finding G-2 sobre content-sniffing.
- `segurasist-api/test/integration/saml.controller.integration.spec.ts` — nuevo,
  3 tests:
  1. `Content-Type` contiene `application/samlmetadata+xml` AND `charset=utf-8`.
  2. Body contiene `<md:EntityDescriptor` y `AssertionConsumerService`.
  3. `GET /login?tenantId=...` setea cookie `sa_saml_relay`.

### CC-16 — Audit wireup SAML + SCIM

Migration enum extension ya estaba deployed en
`prisma/migrations/20260429_tenant_saml_config/migration.sql` (iter 1).
Iter 2 conecta los callers:

- `segurasist-api/src/modules/audit/audit-writer.service.ts:91-99` —
  `AuditEventAction` union extendida con `saml_login_succeeded`,
  `saml_login_failed`, `scim_user_created`, `scim_user_updated`,
  `scim_user_deleted`. JSDoc anota que el `unknown` cast del writer absorbe el
  drift hasta el primer `prisma generate` post-migration.

- `segurasist-api/src/modules/auth/saml/saml.service.ts`:
  - Constructor: `@Optional() auditWriter?: AuditWriterService`,
    `@Optional() auditCtx?: AuditContextFactory` (Optional para preservar los 11
    unit tests existentes que solo proveen `ENV_TOKEN`).
  - `parseAndValidateAssertion` ahora envuelve el cuerpo iter 1 (renombrado a
    `parseAndValidateAssertionInner`) en try/catch y emite:
    - **happy** → `recordAuditSuccess({assertionHashSha256, email})`
      `action='saml_login_succeeded'`, `resourceType='auth.saml'`,
      `resourceId=tenantId`, payload incluye hash + email.
    - **reject** → `recordAuditFailure({reasonHash})` con SHA-256 del reason
      code platform-controlled (`saml.signature_invalid` etc). NEVER persiste
      el XML ni el email — defense-in-depth.
  - Ambos helpers son fire-and-forget (`void this.auditWriter.record(...)`),
    consumen `AuditContextFactory.fromRequest()` (ip, ua, traceId) cuando está
    presente.

- `segurasist-api/src/modules/scim/scim.service.ts`:
  - Constructor: `@Optional() auditWriter?`, `@Optional() auditCtx?` (Optional
    porque el integration spec stubea `AuditContextFactory` y omite el writer).
  - `createUser` → `recordAudit('scim_user_created', tenantId, id,
    {externalId, userNameHash, role})`.
  - `replaceUser` → `recordAudit('scim_user_updated', ..., {mode:'replace',
    userNameHash, active})`.
  - `patchUser` → `recordAudit('scim_user_updated', ..., {mode:'patch',
    opCount, opKinds})` — opKinds emite `${op}:${path}` SIN values (los values
    pueden cargar PII).
  - `deleteUser` → `recordAudit('scim_user_deleted', ..., {userNameHash,
    softDelete:true})`.
  - Helper `hashUserName(s)` = SHA-256 de `userName.toLowerCase()` para
    correlación cross-event sin persistir el email plain.

**Conteo wireup**: 7 callers (2 SAML happy/reject + 5 SCIM create/replace/patch/
delete + el patchUser cuenta como un solo caller) — efectivos **7 emisiones de
audit**: 1 saml_login_succeeded, 1 saml_login_failed, 1 scim_user_created, 2
scim_user_updated (replace + patch), 1 scim_user_deleted. Más 1 para el catch
all (reasonHash) en SAML reject.

### CC-17 — `policies.sql` array

- `segurasist-api/prisma/rls/policies.sql:84-91` — agregadas dos entradas al
  array canónico:
  - `'tenant_saml_config'` con comentario apuntando a la migración 20260429.
  - `'tenant_scim_config'` con la misma referencia.
- Sin trailing comma en el último elemento del array (PG no lo acepta).
- Coordinación MT-1: MT-1 NO editó `policies.sql` en iter 1 — su trabajo de
  branding cayó en columnas existentes de la tabla `tenants` (no nueva tabla
  con tenant_id propio). NO conflicto, NO commit racing necesario.

## NEW-FINDING

### NEW-FINDING-S5-1-05 — `prisma generate` requerido para los 5 enum values nuevos

`AuditEventAction` (TS union) ya carga los 5 valores SAML/SCIM (iter 2). El
cliente Prisma generado contra `schema.prisma` aún expone `AuditAction` SIN
estos valores hasta que `prisma generate` corra contra la migración
`20260429_tenant_saml_config`. El writer absorbe el drift con el cast
`event.action as unknown as Prisma.AuditLogCreateInput['action']` que ya
existía (línea 262 del writer, comentada) — funciona en runtime porque la DB
acepta el valor. Acción CI: validar que el step `prisma generate` corre antes
de los tests de integración que esperan SAML/SCIM rows.

### NEW-FINDING-S5-1-06 — Mock IdP keys nunca al repo

El `.gitignore` adyacente bloquea `idp-private.pem`, `idp-public.pem` y
`*.local.pem`. El generador es idempotente — llamarlo en `beforeAll` no rota
las keys si ya existen. Pero **CI siempre regenera fresh** (workflow start),
así que un commit accidental de PEM se atrapa con un grep:

```yaml
- name: assert no IdP keys committed
  run: |
    if git grep -q "BEGIN PRIVATE KEY" segurasist-api/test/fixtures/mock-idp/keys/; then
      echo "fixture key leaked"; exit 1
    fi
```

Recomendado para Sprint 6 G-1.

### NEW-FINDING-S5-1-07 — SamlService ahora request-scoped por tránsitividad

Inyectar `AuditContextFactory` (Scope.REQUEST) en `SamlService` propaga el
scope: cada request crea una nueva instancia. El costo es despreciable (no hay
estado pesado en SamlService), pero documento para que iter 3 no se sorprenda
si optimiza con DEFAULT scope. La salida limpia es separar el factory de
context-building del audit emission helper, o inyectar `AuditWriter` solo y
construir el ctx en el controller — pendiente Sprint 6.

### NEW-FINDING-S5-1-08 — Audit reason no incluye PII pero sí leak de capability

`recordAuditFailure` hashea el `reason` code (`saml.signature_invalid`,
`saml.tenant_claim_mismatch`, etc.). El hash es determinístico → un consumer
del audit_log puede mappear hashes ↔ codes con un dictionary attack offline
(solo 8 valores posibles). Esto NO es PII, pero sí leak de la implementación
de validaciones SAML del SP. Mitigación si SecOps lo requiere: mantener un
mapping en memoria `code → opaqueId` que se rotee por deploy. Defer Sprint 6.

## Para Sprint 6

1. Unskip los 3 tests E2E SAML (`saml-flow.spec.ts`) con la fixture mock-IdP
   live + Okta dev tenant.
2. Swap parser SAML in-tree por `samlify` (post SecOps review CC review).
3. Prisma model + service `TenantSamlConfigService` (env stub → DB query con
   cache 5min, RLS bypass via `segurasist_admin`).
4. Admin UI proxy routes `apps/admin/app/api/admin/saml/{save,test}`.
5. JIT provisioning toggle + flow ACS que crea la fila User cuando
   `tenant_saml_config.jit_provisioning=true`.
6. SCIM Groups CRUD (iter 1+2 stub a 404).
7. SAML SLO (Single Logout) — `idp_slo_url` está persistida pero sin consumer.
8. CI grep tripwire (NEW-FINDING-06).

## Resumen entregables iter 2

- 4 fixtures bajo `test/fixtures/mock-idp/` (README + .gitignore + generator +
  template + signer).
- 1 stub E2E con 3 it.skip.
- 1 charset fix + 3 tests integration nuevos.
- 5 nuevos audit emissions wired (SAML happy + reject + SCIM CRUD).
- 5 enum values agregados al `AuditEventAction` union.
- 2 nuevas tablas RLS en el array canónico de `policies.sql`.
- 4 NEW-FINDINGs documentadas con paths de mitigación.

## Bloqueos

- Ninguno crítico.
- `npx jest` no se corrió en este worktree (validation gate D5).
- Las llaves del mock IdP NO fueron commiteadas — generator se ejecuta en CI o
  en `beforeAll` del primer test. Es la postura intencional (sandbox bash no
  ejecuta openssl/node-crypto, y CI debe regenerar fresh anyway).
