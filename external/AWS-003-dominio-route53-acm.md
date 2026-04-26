# AWS-003 — Dominio segurasist.app + Route 53 + ACM

**Estado:** ⬜ Pendiente
**Bloquea:** publicación de admin/portal/api con HTTPS
**Owner:** DevOps + PO
**Referencia:** `MVP_03_Arquitectura_SegurAsist.docx` §5.3

## Contexto

Necesitamos un dominio raíz registrado y delegado a Route 53 para servir:

| Subdominio | Apunta a | Uso |
|---|---|---|
| `admin.segurasist.app` | Amplify Hosting | Portal admin SSR |
| `portal.segurasist.app` | Amplify Hosting | Portal asegurado SSR |
| `api.segurasist.app` | App Runner via WAF | API REST |
| `files.segurasist.app` | CloudFront → buckets S3 | PDFs firmados |
| `status.segurasist.app` | UptimeRobot | Status page externo |
| `auth.segurasist.app` | Cognito Hosted UI (admin) | OAuth flow |
| `auth-portal.segurasist.app` | Cognito Hosted UI (portal) | OTP flow |

## Pasos

### 1. Registrar dominio (si aún no se posee)

Opciones recomendadas (orden de preferencia):
1. **Route 53 Domains** (~$14 USD/año `.app`, integrado): Console → Route 53 → Domains → "Register domain". Cuenta `prod`.
2. Registrador externo con soporte `.app` (Google Domains, Namecheap, Cloudflare) y delegación a Route 53.

> El TLD `.app` está operado por Google Registry y **fuerza HTTPS via HSTS preload list** — perfecto para nuestra postura de seguridad. Al estar en HSTS preload todos los navegadores rechazan el plaintext sin negociación.

### 2. Crear Hosted Zone pública en Route 53 (cuenta `prod`)

- Console → Route 53 → Hosted zones → "Create".
- Domain: `segurasist.app`
- Type: Public
- Anotar los 4 NS records que asigna AWS y publicarlos en el registrador (si no es Route 53 Domains).

### 3. Hosted Zone privada (opcional, fase 2)

Si en el futuro necesitamos resolución interna (ej. RDS endpoints amigables), crear `internal.segurasist.app` privada.

### 4. Solicitar certificados ACM (DOS certificados — mismo dominio, dos regiones)

Necesitamos **dos** certificados ACM con el mismo set de dominios pero en regiones distintas, porque CloudFront y Amplify Hosting **siempre** requieren ACM en `us-east-1`, mientras que ALB / App Runner / API Gateway en mx-central-1 requieren un cert local.

| Certificado | Región | SANs | Usado por |
|---|---|---|---|
| `segurasist-app-regional` | `mx-central-1` | `segurasist.app`, `*.segurasist.app` | App Runner, ALB, API Gateway |
| `segurasist-app-cloudfront` | `us-east-1` | `segurasist.app`, `*.segurasist.app` | CloudFront, Amplify Hosting |

Por cada uno:
- Console → ACM → "Request" → public certificate (en la región correspondiente)
- Add `segurasist.app` y `*.segurasist.app`
- Validation: **DNS** (botón "Create records in Route 53"). Como ambos cubren el mismo dominio, los CNAME de validación son idénticos — Route 53 los acepta una sola vez.
- Renovación automática: ON

> **Esto ya está modelado en `segurasist-infra/global/route53/main.tf`** con dos recursos `aws_acm_certificate` y un alias de provider `aws.us_east_1`.

### 5. Health checks

- Crear health check para `https://api.segurasist.app/health/ready` (interval 30s).
- Crear health check para `https://admin.segurasist.app` y `https://portal.segurasist.app`.
- Asociar a alarmas SNS para failover.

### 6. Failover routing (Sprint 5)

Configurar registros con failover policy primary (`mx-central-1`) → secondary (`us-east-1`) para `api.segurasist.app` cuando el SKU 99.9% se active. Ver `ADR-014` para el racional del cambio de región primaria a México.

## Evidencia esperada

- [ ] Hosted zone `segurasist.app` creada con 4 NS visibles en `dig NS segurasist.app`
- [ ] Certificado ACM `*.segurasist.app` en estado "Issued"
- [ ] Health checks configurados

## Costo

- Dominio `.app`: ~$14/año
- Hosted zone: $0.50/mes
- Health checks: $0.50/mes c/u
- ACM: gratis
- **Total año 1: ~$32 USD**
