# SegurAsist — Accesos de prueba (dev local)

> **Solo dev**. Estos passwords y rutas viven en `cognito-local` + `LocalStack`
> y NO existen en prod. En staging/prod las credenciales se gestionan vía
> AWS Cognito real + 1Password vault del equipo (OPS-001).
>
> Última actualización: 2026-04-28

---

## URLs del stack local

| Componente | URL |
|---|---|
| **Admin frontend** | http://localhost:3001/login |
| **Portal asegurado** | http://localhost:3002/login |
| **API NestJS** | http://localhost:3000 |
| **Swagger / OpenAPI spec** | http://localhost:3000/v1/openapi.json |
| **Mailpit (correos capturados)** | http://localhost:8025 |
| **PostgreSQL** | `postgresql://segurasist:segurasist@localhost:5432/segurasist` |

---

## 1. Admin pool — 4 roles

Login en **http://localhost:3001/login** con `email` + `password`.

| Rol | Email | Password | Permisos clave |
|---|---|---|---|
| **Superadmin** | `superadmin@segurasist.local` | `Demo123!` | Cross-tenant. Tenant switcher visible. Único que puede `GET /v1/tenants`, `GET /v1/audit/verify-chain`, `GET /v1/tenants/active`. Ve insureds/packages/coverages de cualquier tenant. |
| **Admin MAC** | `admin@mac.local` | `Admin123!` | Admin del tenant Hospitales MAC. Insureds CRUD, batches, certificates, reports (S4-01/02/03), users, audit log, vista 360. Sidebar 7 items (todos). |
| **Operator** | `operator@mac.local` | `Demo123!` | Carga de lotes + emisión certificados. Lectura coverages. Sidebar 3 items: Resumen, Asegurados, Lotes. Sin acceso a `/users`, `/reports`, `/settings`. |
| **Supervisor** | `supervisor@mac.local` | `Demo123!` | Lectura todo + audit log + reportes. Sidebar 3 items: Resumen, Asegurados, Reportes. Sin acceso a `/users` ni `/settings`. |

**Verificación rápida** que tu login funcionó:
- Header (top-right): chip muestra rol exacto (Superadmin / Admin MAC / Operador / Supervisor)
- Sidebar: cantidad de items cambia según rol
- Deep-link a página fuera de tu rol (ej. operator → `/users`) renderiza `AccessDenied` con CTA "Volver al resumen"

---

## 2. Insured pool — portal asegurado

**No login con email + password.** Flujo OTP (CURP → email con código → verify).

| Atributo | Valor |
|---|---|
| **CURP** | `HEGM860519MJCRRN08` |
| **Email destino del OTP** | `insured.demo@mac.local` |
| **Nombre** | María Hernández García |
| **Paquete** | Premium |
| **Vigencia** | 2026-01-01 → 2027-03-31 |
| **Tenant** | `mac` |

### Flow paso a paso

1. Ve a **http://localhost:3002/login**
2. Ingresa CURP `HEGM860519MJCRRN08`
3. Selecciona canal **Email**
4. Click **"Enviar código"**
5. Abre **Mailpit** en otra tab → http://localhost:8025
6. Encuentra el email "Tu código de acceso a Mi Membresía MAC" (subject)
7. Copia el **código de 6 dígitos** del cuerpo
8. Vuelve al portal — te llevó a `/otp` automáticamente
9. Pega el código → entras a la home con datos reales de María

### Throttle

- `POST /v1/auth/otp/request` → **5 req/min** por IP (S4-10)
- Si te limita, espera 60s

### Insured pool isolation (verifica que no hay cross-pool login)

- **NO puedes** loguear `insured.demo@mac.local` en http://localhost:3001/login (admin pool) → la API devuelve 401 antes de emitir token
- **NO puedes** loguear admin/operator/supervisor en el portal por OTP (sus pools son distintos: `local_admin` vs `local_insured`)

---

## 3. Endpoints accesibles por rol (matriz)

Verificable con curl después de hacer login y obtener `idToken`:

| Endpoint | Superadmin | Admin MAC | Operator | Supervisor | Insured |
|---|:---:|:---:|:---:|:---:|:---:|
| `GET /v1/insureds` | ✅ | ✅ | ✅ | ✅ | ❌ 403 |
| `GET /v1/packages` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `GET /v1/coverages` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `GET /v1/reports/dashboard` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `GET /v1/reports/conciliacion?from=&to=` | ✅ | ✅ | ❌ | ✅ | ❌ |
| `GET /v1/users` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET /v1/audit/log` | ✅ | ✅ | ❌ | ✅ | ❌ |
| `GET /v1/audit/verify-chain` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /v1/tenants` / `/v1/tenants/active` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /v1/insureds/:id/360` (vista 360) | ✅ | ✅ | ✅ | ✅ | ❌ |
| `GET /v1/insureds/me` (insured-only) | ❌ 403 | ❌ | ❌ | ❌ | ✅ |
| `GET /v1/certificates/mine` (insured-only) | ❌ | ❌ | ❌ | ❌ | ✅ |
| `GET /v1/insureds/me/coverages` | ❌ | ❌ | ❌ | ❌ | ✅ |
| `POST /v1/claims` (reportar siniestro) | ❌ | ❌ | ❌ | ❌ | ✅ |
| `POST /v1/chatbot/message` | ❌ | ❌ | ❌ | ❌ | ✅ |
| `GET /v1/certificates/verify/:hash` (público) | ✅ | ✅ | ✅ | ✅ | ✅ (sin auth requerido) |

✅ = 200 OK · ❌ = 403 Forbidden · 401 si falta token válido.

---

## 4. Datos demo seedeados

Un solo tenant `mac` (Hospitales MAC, id `797bd87f-e188-4f22-a023-3291d055cf16`).

| Tabla | Filas seedeadas |
|---|---|
| `tenants` | 1 — Hospitales MAC |
| `users` | 5 — admin_segurasist, admin_mac, operator, supervisor, insured (cada uno con cognito_sub real sincronizado por `cognito-local-bootstrap.sh`) |
| `packages` | 1 — Premium |
| `insureds` | 1 — María Hernández García (CURP `HEGM860519MJCRRN08`, cognito_sub linked) |
| `coverages` | 4 — Consultas médicas, Hospitalización, Urgencias, Laboratorios (todas pkg Premium) |
| `certificates` | 1 — v1, status `issued`, vigente hasta 2027-03-31, PDF dummy en LocalStack S3 |

---

## 5. Featured flows para probar

### 5.1 Admin (admin_mac)

1. Login → dashboard con KPIs
2. Sidebar → **Asegurados** → busca "María" → click → **Vista 360** con 5 tabs
3. Sidebar → **Reportes** → 3 cards (Conciliación / Volumetría / Utilización) → click "Conciliación mensual" → form con date pickers + descargar PDF/XLSX
4. Sidebar → **Lotes** → 4 rows mock + CTA "Nuevo lote" → wizard 3 pasos
5. Top bar → ⌘K (Mac) o Ctrl+K (Win) → command palette
6. Top bar → toggle sun/moon → dark/light persiste

### 5.2 Superadmin (admin_segurasist)

1. Login
2. Top bar → **Tenant switcher** dropdown — cambia entre "Mi tenant (sin override)" y "Hospitales MAC"
3. Cuando switcheas a un tenant: banner amber sticky "Modo cross-tenant: viendo datos de Hospitales MAC"
4. Auditoría: cada read con override registra `_overrideTenant` + `_overriddenBy` en `audit_log`

### 5.3 Insured portal (María)

1. CURP → OTP → home: "Hola, María" + status hero "Vigente"
2. Bottom nav → **Coberturas** → 4 cards con ProgressBar
3. Bottom nav → **Certificado** → botón "Descargar mi certificado" abre PDF en pestaña nueva
4. Bottom nav → **Ayuda** → tel + email + chatbot info
5. Avatar (top-right) → **Mi perfil** → datos read-only + CTA llamar
6. Avatar → **Cerrar sesión** → cookies limpiadas, redirige a `/login`
7. FAB chatbot (esquina inferior derecha) → drawer del asistente virtual

---

## 6. Troubleshooting

| Síntoma | Causa probable | Fix |
|---|---|---|
| `/login` admin/portal en blanco | Cache del browser stale | `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Win) |
| Login OTP da `loginInsuredWithSystemPassword falló` | `INSURED_DEFAULT_PASSWORD` desincronizado con cognito-local | Re-correr `./scripts/cognito-local-bootstrap.sh` |
| `/api/proxy/v1/...` da 503 | content-encoding gzip mal forwardeado (FIXED commit `b371e6a`) | Reiniciar admin/portal: `pkill -f "next dev"` + relanzar |
| `/insureds` página en blanco | `.next` cache stale del build viejo | `rm -rf segurasist-web/apps/admin/.next` + restart |
| Throttle 429 en login burst | Hits >5/min en `/v1/auth/otp/request` | Espera 60s |
| Mailpit no recibe email | SMTP env mal configurado | `SMTP_HOST=localhost`, `SMTP_PORT=1025` en `segurasist-api/.env` |

---

## 7. Reset desde cero

Si la BD se contamina o necesitas estado limpio:

```bash
cd segurasist-api
docker compose down -v       # destruye volúmenes
docker compose up -d         # postgres + redis + localstack + mailpit + cognito-local
./scripts/local-up.sh        # bootstrap completo idempotente
npm run dev                  # API en :3000

# En otras terminales:
cd segurasist-web && pnpm install
pnpm --filter @segurasist/admin dev    # :3001
pnpm --filter @segurasist/portal dev   # :3002
```

**Nota**: el seed actual NO incluye `coverages` ni el `certificate` demo (ver tabla §4). Esos los inserto manualmente cuando hago smoke E2E. Si quieres datos demo permanentes en seed, abrir issue para extender `prisma/seed.ts`.

---

## 8. Pre-go-live checklist (para Sprint 5)

Antes de subir esto a staging/prod, lista de cosas que NO deben quedar como dev:

- [ ] `INSURED_DEFAULT_PASSWORD` rotar a un valor random ≥ 14 chars (env validator C-04 lo valida)
- [ ] `Admin123!` / `Demo123!` deshabilitados — auth via Cognito real con MFA TOTP obligatorio
- [ ] `cognito-local` reemplazado por `cognito-idp.mx-central-1.amazonaws.com`
- [ ] `LocalStack` reemplazado por AWS real (S3 con Object Lock, KMS CMK rotación 365d, SES out-of-sandbox)
- [ ] `Mailpit` reemplazado por SES (AWS-002 desbloquea sandbox)
- [ ] DPA AWS firmado (LEG-001) + Aviso de Privacidad publicado
- [ ] SAML Azure AD MAC para admins federado (MAC-001)
- [ ] Branch protection en GitHub + CI verde + DAST/Semgrep clean (GH-001/002 + S5)
- [ ] Pentest tercerizado contra staging (Sprint 5)
- [ ] `.env.local` archivos NO commiteados (verificado: están en `.gitignore`)
