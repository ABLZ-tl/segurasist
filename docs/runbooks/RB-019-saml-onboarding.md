# RB-019 — SAML SSO onboarding (per-tenant)

- **Owner**: S5-1 / Identity backend.
- **Audience**: SegurAsist on-call + tenant admin (cliente).
- **Tiempo estimado**: 30-45 min por tenant (Okta) / 45-60 min (AzureAD).
- **Pre-requisitos**:
  - Tenant ya creado en `tenants` (slug + status=active).
  - Tenant admin (`role=admin_mac`) tiene acceso a `/identity/saml` en el
    portal admin.
  - Cliente posee privilegios "Application admin" (Okta) o "Cloud
    Application Admin" (AzureAD) en su IdP corporativo.

## Visión general del flujo

```
[Tenant admin]                [SegurAsist API]               [IdP corp]
       |                              |                              |
  1. /identity/saml ----------------> |                              |
       | <-- form vacío             |                              |
  2. Genera SP metadata <------------ GET /v1/auth/saml/metadata     |
       |                              |                              |
  3. Sube SP metadata --------------------------------------------> |
       | <----- IdP genera entityID, SSO URL, X.509 ---------------- |
  4. Pega valores en /identity/saml |                              |
       | -- POST guardar config -->  |                              |
  5. "Probar conexión"               |                              |
       | -- POST /saml/test ------>  | -- AuthnRequest --> .........|
       | <-- redirect URL ---------- |                              |
       | -- click ----------------------- redirect IdP login ----> |
       | -- assertion POST <----------- ACS valida firma <--------- |
       | <-- "OK" + claims extraídos                                |
  6. Activar (enabled=true)          |                              |
```

## Paso 1 — Descargar SP metadata

1. Login en el portal admin como `admin_mac` o `admin_segurasist`.
2. Navegar a `/identity/saml`.
3. Click "Descargar SP metadata.xml".
4. El XML descargado contiene:
   - `entityID` = `https://api.segurasist.local/saml/sp` (override por
     env `SAML_SP_ENTITY_ID`).
   - `AssertionConsumerService Location` =
     `https://api.segurasist.local/v1/auth/saml/acs` (override por
     `SAML_SP_ACS_URL`).
   - `WantAssertionsSigned="true"` — el IdP DEBE firmar.

## Paso 2 — Configurar la app en el IdP

### 2a) Okta

1. Okta admin console → Applications → Create App Integration → SAML 2.0.
2. General Settings:
   - **App name**: `SegurAsist (<tenant-slug>)`.
3. SAML Settings:
   - **Single sign on URL**: `https://api.segurasist.local/v1/auth/saml/acs`.
   - **Audience URI (SP Entity ID)**: `https://api.segurasist.local/saml/sp`.
   - **Name ID format**: EmailAddress.
   - **Application username**: Email.
   - **Attribute Statements** (críticos):
     - `email` → `user.email`
     - `custom:tenant_id` → `<UUID literal del tenant — copiar de tenants.id>`
     - `custom:role` → `admin_mac` (o usar grupos de Okta para mapear)
4. Asignar la app al grupo de admins del tenant (ej. "MAC Admins").
5. Sign On tab → SAML Setup → "View Setup Instructions". Copiar:
   - `Identity Provider Single Sign-On URL` → `idpSsoUrl`.
   - `Identity Provider Issuer` → `idpEntityId`.
   - `X.509 Certificate` (PEM) → `idpX509Cert`.

### 2b) AzureAD

1. Azure Portal → Enterprise Applications → New application → Non-gallery.
2. Single sign-on → SAML.
3. Basic SAML Configuration:
   - **Identifier (Entity ID)**: `https://api.segurasist.local/saml/sp`.
   - **Reply URL**: `https://api.segurasist.local/v1/auth/saml/acs`.
4. User Attributes & Claims:
   - Required claim Name ID = `user.mail`.
   - Add claim `email` → `user.mail`.
   - Add claim `custom:tenant_id` → constant string (UUID del tenant).
   - Add claim `custom:role` → `admin_mac` (constant; o por grupo).
5. SAML Signing Certificate → "Federation Metadata XML" descarga; abrir
   y extraer:
   - `<X509Certificate>` interior → `idpX509Cert` (incluir headers PEM).
   - `<EntityDescriptor entityID="...">` → `idpEntityId`.
   - `<SingleSignOnService Binding=".../HTTP-POST" Location="...">` →
     `idpSsoUrl`.

## Paso 3 — Cargar configuración en SegurAsist

1. En `/identity/saml`, llenar:
   - **IdP Entity ID** ← lo copiado del IdP.
   - **SSO URL** ← idem.
   - **SLO URL** ← opcional (logout SAML; iter 2 lo consume).
   - **IdP Metadata URL** ← opcional; si lo pones, se prefiere sobre
     `idpX509Cert` y se actualiza automáticamente cuando el IdP rota.
   - **Certificado X.509** ← pega el PEM completo (con
     `-----BEGIN CERTIFICATE-----` / `-----END CERTIFICATE-----`).
2. Click "Guardar".
3. La fila en `tenant_saml_config` queda con `enabled=false` por default
   (no activa hasta que pase el smoke test).

## Paso 4 — Smoke test ("Probar conexión")

1. Click "Probar conexión".
2. El backend genera una AuthnRequest dummy (RelayState etiquetada con
   `_test:<tenantId>`) y devuelve la redirect URL al IdP.
3. Abrir la URL en una pestaña incógnito → login con una cuenta admin
   del IdP.
4. El IdP postea el assertion al ACS. El backend:
   - Valida firma contra `idpX509Cert` (rechaza con
     `saml.signature_invalid` si no matcha).
   - Valida `NotBefore` / `NotOnOrAfter` con 60s skew.
   - Valida `Issuer == idpEntityId`.
   - Valida `custom:tenant_id == tenantId del config`.
   - Audit log `saml_login_succeeded` con
     `assertionHashSha256` (NO el XML — política PII).
5. Si todo OK → response `{ ok: true, redirectTo: '/dashboard' }`.

## Paso 5 — Activar

1. Marcar `tenant_saml_config.enabled = true` (toggle UI iter 2; iter 1
   lo hace el on-call con SQL en staging).
2. Anunciar el cutover a usuarios admin del tenant: `https://admin.segurasist.local/saml/login?tenantId=<uuid>`.

## Troubleshooting

| Error                          | Causa probable                                      | Fix                                                                   |
|---|---|---|
| `saml.signature_invalid`       | Cert PEM mal pegado / IdP rotó el cert              | Re-descargar cert del IdP, actualizar `idpX509Cert`.                  |
| `saml.issuer_mismatch`         | `idpEntityId` no matchea `<Issuer>` en el assertion | Copiar exacto del IdP setup (case-sensitive, slash trailing).         |
| `saml.tenant_claim_mismatch`   | `custom:tenant_id` claim != tenant del config       | Verificar el constant string del IdP (UUID exacto del row `tenants`). |
| `saml.assertion_expired`       | Clock skew tenant-side >60s                         | NTP en el IdP corporativo / contactar IT del tenant.                  |
| `saml.missing_email_claim`     | El IdP no está mapeando `email` → user.mail         | Volver al paso 2 attribute mappings.                                  |
| `saml.tenant_not_configured`   | `tenant_saml_config.idp_x509_cert` vacío            | Re-pegar cert PEM con headers `BEGIN/END CERTIFICATE`.                |
| Loop redirect /login → IdP     | Cookie `sa_saml_relay` bloqueada                    | Verificar SameSite; algunos browsers en modo incógnito agresivo lo cortan. |

## Cert rotation

Cuando el IdP avise rotación (Okta envía email 60d antes; AzureAD 30d):

1. Antes de la rotación: editar `idpX509Cert` con el nuevo cert. SAML
   acepta los DOS certs (legacy + new) durante el window — iter 2
   habilita `idpX509CertSecondary`.
2. Después de la rotación: borrar el cert viejo.
3. Audit `saml.cert.rotated` (iter 2).

## Métricas / alarmas

- `saml.login.failed.count{tenantId, reason}` >5 en 5min → page on-call.
- `saml.login.success.count{tenantId}` =0 por >24h → mail tenant admin
  (¿quedó la integración rota?).
- `saml.assertion.hash.duplicate` >0 → posible replay attack
  (assertion hash visto antes; iter 2 implementa cache de assertion IDs).
