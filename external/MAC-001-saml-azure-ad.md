# MAC-001 — Federación SAML con Azure AD MAC

**Estado:** ⬜ Pendiente
**Bloquea:** S5-02 (SSO real con MAC) y S5-03 (SCIM provisioning)
**Owner:** PO + DevOps + IT MAC
**Plan B:** Cognito local con MFA TOTP (ya planeado en S1-01)
**Referencia:** `MVP_03_Arquitectura_SegurAsist.docx` ADR-004 + `MVP_02_Plan_Proyecto_SegurAsist.docx` R-02

## Contexto

Los operadores MAC (Lucía y compañía) deben loguearse al portal admin con sus credenciales corporativas (Azure AD MAC) sin gestionar contraseñas separadas. Cognito User Pool admin actúa como **Service Provider (SP)** y Azure AD como **Identity Provider (IdP)**.

Este es un riesgo de cronograma identificado (R-02): si MAC no provee credenciales SAML a tiempo, Sprint 5 se desliza. Plan B es Cognito local con MFA, sin federación.

## Pasos para coordinar con MAC IT

### 1. Solicitud formal a MAC IT

Asunto: "Solicitud de federación SAML 2.0 — SegurAsist (proveedor SaaS Roy)"

Cuerpo (template):

> Como parte del despliegue del MVP SegurAsist (proyecto firmado entre Hospitales MAC y Roy/Innovación Segura, abril 2026), requerimos habilitar Single Sign-On entre Azure AD de MAC y nuestro proveedor de identidad (AWS Cognito).
>
> Necesitamos que su equipo IT cree una **Enterprise Application** en Azure AD con la siguiente configuración:
>
> - **Sign-on URL (ACS):** `https://auth.segurasist.app/saml2/idpresponse`
> - **Identifier (Entity ID):** `urn:amazon:cognito:sp:mx-central-1_XXXXX` (les compartimos el ID exacto al iniciar Sprint 5)
> - **Reply URL:** `https://auth.segurasist.app/saml2/idpresponse`
>
> **Atributos SAML que requerimos (claims):**
> - `email` (NameID format) — único, persistente
> - `givenName`, `surname`, `displayName`
> - `groups` — para mapeo a roles SegurAsist (Admin MAC, Operador, Supervisor)
>
> **Asignación de usuarios:** restringido al grupo de Azure AD `MAC-SegurAsist-Operators` (que ustedes definen).
>
> **Lo que necesitamos de ustedes:**
> 1. Federation Metadata XML (URL pública o archivo).
> 2. Confirmación de los attribute mappings.
> 3. Lista inicial de usuarios autorizados (mínimo: Lucía + 1 backup).

### 2. Cuando MAC entregue el metadata XML

- Subir a Cognito User Pool admin → "Sign-in experience" → "Add identity provider" → "SAML".
- Pegar el metadata URL o subir el XML.
- Mapear atributos:
  - `email` → `email`
  - `custom:role` → grupos SAML (mapping en NestJS según `groups` claim)
  - `custom:tenant_id` → fijo `mac` (todos los usuarios de este IdP pertenecen al tenant MAC)

### 3. Test de extremo a extremo

- Lucía intenta loguearse en `https://admin.segurasist.app`.
- Hace clic en "Iniciar sesión con MAC SSO".
- Es redirigida a Azure AD, ingresa credenciales corporativas.
- Vuelve a SegurAsist con sesión activa, rol asignado correctamente.

### 4. SCIM provisioning (post-SAML)

Si MAC tiene Azure AD Premium P1 o superior, podemos sincronizar altas/bajas automáticamente vía SCIM 2.0:

- Cognito Developer+ tier requerido (~$0.05/MAU activo).
- Endpoint SCIM en `/v1/scim/v2/` (ya planificado en `UsersModule`).
- Permite al equipo IT MAC dar de baja un operador en Azure AD y la cuenta SegurAsist se desactiva en ≤1 min.

## Evidencia esperada

- [ ] Federation Metadata XML recibido de MAC IT
- [ ] Identity provider SAML configurado en Cognito
- [ ] Lucía logra login SSO end-to-end en staging
- [ ] (Opcional) SCIM provisioning sincronizando

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| MAC IT no responde a tiempo (D+15) | Plan B: Cognito local con MFA. Operadores MAC reciben credenciales temporales. |
| MAC usa otro IdP (no Azure AD) | Cognito soporta SAML 2.0 estándar y OIDC. Cambia el flujo de configuración pero no la arquitectura. |
| Atributo `groups` no disponible en SAML claims | Mapear roles manualmente en panel admin SegurAsist (Mario asigna). |

## Plan B activable inmediatamente

Si MAC no responde para Sprint 5, activamos Cognito local:
- MFA TOTP obligatorio (Google Authenticator).
- Mario crea cuentas en panel admin SegurAsist y comparte credenciales temporales.
- Operadores cambian password en primer login.
- Ningún cambio en código, solo configuración.
