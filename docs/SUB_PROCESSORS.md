# SegurAsist — Registro de sub-procesadores

> **Owner**: Tech Lead + DPO (LEG-001)
> **Última actualización**: 2026-04-26
> **Próxima revisión**: trimestral (cada cierre de sprint mayor) + pre Go-Live
> **Documentos relacionados**: [`PROGRESS.md`](./PROGRESS.md) · [`IRP.md`](./IRP.md) · [`OWASP_TOP_10_COVERAGE.md`](./OWASP_TOP_10_COVERAGE.md) · [`INTERIM_RISKS.md`](./INTERIM_RISKS.md) · [`external/LEG-001-dpa-aviso-privacidad.md`](../external/LEG-001-dpa-aviso-privacidad.md)

Este registro lista los terceros que participan en el tratamiento de datos personales, operación o entrega del servicio SegurAsist, en cumplimiento del Art. 36 LFPDPPP y de la cláusula de subprocesadores del DPA SegurAsist↔MAC. Está pensado para anexarse a un security questionnaire enterprise sin retoque.

## Tabla de contenidos

1. [Convenciones](#1-convenciones)
2. [Sub-procesadores actuales y planeados](#2-sub-procesadores-actuales-y-planeados)
3. [Política de evaluación de nuevos sub-procesadores](#3-política-de-evaluación-de-nuevos-sub-procesadores)
4. [Cambios y aviso a clientes](#4-cambios-y-aviso-a-clientes)
5. [Auditorías](#5-auditorías)
6. [Data flows](#6-data-flows)

---

## 1. Convenciones

- **Datos compartidos** — categoría:
  - `PII`: datos personales identificables (nombre, email, teléfono, CURP, RFC).
  - `PHI`: información de salud sensible bajo LFPDPPP (membresía de salud, padecimientos).
  - `Sesión`: tokens, cookies, identificadores de sesión.
  - `Audit`: bitácora de acceso y eventos.
  - `Logs`: telemetría aplicacional (sanitizada por scrub recursivo).
  - `Pagos`: información financiera (no aplica MVP — fase 2).
  - `Metadata`: información operativa sin PII (estado de tickets, configuración de tenant).
  - `Ninguno`: el sub-procesador no toca datos productivos (dev-only o framework).
- **Status DPA**:
  - ✅ Firmado y archivado en 1Password vault `Compliance`.
  - 🟡 Pendiente / por verificar pre Go-Live.
  - 🔴 No aplicable.
- **Tier**: nivel de soporte/contrato contratado (Free / Team / Business / Enterprise).
- **Owner interno**: rol responsable del seguimiento del sub-procesador (renovaciones, revisiones, alertas de seguridad).

---

## 2. Sub-procesadores actuales y planeados

### 2.1 Productivos (path de datos reales)

| Vendor | Servicio que provee | Datos compartidos | Región de procesamiento | Tier | Status DPA | Certificaciones | Privacy / Security URL | Último review | Owner |
|---|---|---|---|---|---|---|---|---|---|
| **Amazon Web Services, Inc.** | Cognito User Pools (auth admin + insured), RDS PostgreSQL (DB), S3 (audit / certificates / exports / uploads), SES (transactional email), KMS (CMK), Secrets Manager, App Runner (API hosting), Amplify Hosting (admin + portal), CloudWatch Logs + Metrics, GuardDuty, Security Hub, Config, WAF, Route 53, ACM | PII · PHI · Sesión · Audit · Logs · Metadata | mx-central-1 (primaria) + us-east-1 (DR + servicios globales: CloudFront, ACM-for-CloudFront, Route 53, IAM) | Business Support (TBD pre Go-Live, Developer en dev) | 🟡 LEG-001 — DPA marco vía AWS Artifact pendiente de firma | ISO/IEC 27001, 27017, 27018; SOC 1/2/3 Type II; PCI-DSS L1; HIPAA-eligible (BAA); FedRAMP High; CSA STAR; HITRUST | https://aws.amazon.com/compliance/ | 2026-04-26 (catalogación inicial) | Tech Lead + DevOps |
| **GitHub, Inc.** (Microsoft) | Repositorio de código fuente, CI/CD vía GitHub Actions, Dependabot, GitHub Advanced Security (secret scanning + code scanning) | Código fuente (incluye plantillas y configuración, sin datos productivos), secretos de Actions cifrados, logs de pipeline | EE.UU. (multi-region Microsoft) | Team / Enterprise (TBD — GH-001) | 🟡 Microsoft Online Services DPA estándar pendiente de aceptación con la org corporativa | ISO/IEC 27001, 27018; SOC 1/2 Type II; FedRAMP Moderate | https://github.com/security · https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum | 2026-04-26 | DevOps |
| **Anthropic, PBC** | Claude API para chatbot del portal asegurado (Sprint 4) | Mensajes del chat (por diseño NO se envía PHI; el prompt está restringido a información de membresía no sensible y la API se invoca sin CURP/RFC) | EE.UU. | Workspaces / API Tier 2 (TBD pre Sprint 4) | 🟡 Anthropic DPA pendiente firma | SOC 2 Type II | https://www.anthropic.com/legal/privacy · https://trust.anthropic.com | n/a (Sprint 4) | Tech Lead |
| **UptimeRobot** (IT Genius Web Solutions) | Monitoring externo (status page pública, health checks) | Pings a `/health/ready` y subdominios públicos. Sin PII. Email del on-call para alertas | UE (Lituania) | Pro (50 monitors) — OPS-003 | 🟡 DPA estándar pendiente | SOC 2 (declarado en su trust page; verificar reporte vigente) | https://uptimerobot.com/legal/privacy-security-policy | n/a (OPS-003 pendiente) | DevOps |
| **PagerDuty, Inc.** | On-call rotación + alerting integrado a CloudWatch / GuardDuty / UptimeRobot | Email + número de celular del on-call, payload sanitizado de la alerta (sin PII de asegurados) | EE.UU. | Free Tier inicial → Professional post Go-Live — OPS-002 | 🟡 Standard DPA pendiente | SOC 2 Type II; ISO/IEC 27001 | https://www.pagerduty.com/security/ | n/a (OPS-002 pendiente) | DevOps |
| **1Password (AgileBits Inc.)** | Vault corporativo de credenciales y secretos del equipo, archivo de DPAs firmados, claves de recuperación de incidentes | Credenciales del equipo, claves API, claves GPG, archivos legales firmados. NO datos de asegurados | EE.UU. + Canadá | Business — OPS-001 | 🟡 Standard DPA pendiente | SOC 2 Type II; ISO/IEC 27001, 27017, 27018, 27701 | https://1password.com/security · https://1password.com/legal/data-processing-agreement | n/a (OPS-001 pendiente) | Tech Lead |

### 2.2 Sub-procesadores planeados (no activos en MVP)

Vendors anticipados en el roadmap; aún no procesan datos. Se incluyen en este registro para que clientes y auditores conozcan la dirección estratégica con 30 días de anticipación implícita.

| Vendor | Servicio anticipado | Datos previstos | Sprint de incorporación | Estado |
|---|---|---|---|---|
| **Sentry** o **Datadog** (TBD) | APM + error tracking + RUM | Logs sanitizados (scrub recursivo en `pino` ya elimina email/CURP/RFC/auth headers; ver `M5` en PROGRESS) | Sprint 5 | 🟡 Selección pendiente; revisión SOC 2 Type II y residencia antes de contratar |
| **Stripe** o **Conekta** (TBD) | Procesamiento de pagos (fase 2 post Go-Live MVP) | PCI-DSS scope reducido vía hosted fields; SegurAsist no almacena PAN | Post Sprint 6 | 🔴 No aplicable MVP |

### 2.3 Herramientas de desarrollo local (no procesan datos productivos)

Listados por completitud y para que el cliente entienda que NO son sub-procesadores en sentido jurídico (no tocan datos reales). Se ejecutan exclusivamente en máquinas de desarrollo bajo `docker-compose` y se reemplazan por servicios AWS en Sprint 5.

| Componente | Reemplaza en producción | Datos | Observación |
|---|---|---|---|
| `jagregory/cognito-local` (Docker image, OSS) | Amazon Cognito | Ninguno (datos seed ficticios) | Imagen pública en Docker Hub. Verificar SHA256 antes de pull en CI. |
| `localstack/localstack` (Docker image, OSS) | S3 + KMS + SQS + Secrets Manager (AWS) | Ninguno | Idem. |
| `axllent/mailpit` (Docker image, OSS) | Amazon SES | Ninguno | Captura SMTP local. No se conecta a internet. |
| `postgres:16-alpine` (Docker image oficial) | RDS PostgreSQL 16 | Ninguno productivo | Imagen oficial Postgres. |
| `redis:7-alpine` (Docker image oficial) | ElastiCache Redis Serverless | Ninguno | Idem. |
| Next.js (Vercel, Inc.) | n/a — framework, NO hosting | Ninguno | Hosting es Amplify (AWS). El paquete npm `next` NO es un sub-procesador. |

> **Posición sobre OSS y framework providers**: Vercel/Next.js, jagregory, LocalStack, Mailpit y los registries OSS (npmjs, PyPI, Docker Hub) **no son sub-procesadores en sentido jurídico** porque no procesan datos de SegurAsist en su infraestructura. Sólo proveen software que ejecutamos en infraestructura propia o en AWS. Se listan por transparencia, no por obligación regulatoria.

---

## 3. Política de evaluación de nuevos sub-procesadores

Antes de contratar a un nuevo sub-procesador, el DPO valida:

| Criterio | Mínimo aceptable | Bloqueante |
|---|---|---|
| Certificación de seguridad de información | SOC 2 Type II vigente (último reporte ≤ 12 meses) **o** ISO/IEC 27001 vigente | Sí — sin esto no se contrata |
| DPA firmable | Acepta términos compatibles con LFPDPPP (encargado/sub-encargado, brechas en ≤72 h, derecho de auditoría, devolución/destrucción al fin del contrato) | Sí |
| Residencia de datos | Documentada y aceptable conforme al Aviso de Privacidad publicado | Sí (cualquier salto a residencia nueva requiere aviso de cliente conforme a §4) |
| Cifrado en reposo y en tránsito | TLS 1.2+ en tránsito; cifrado at-rest con clave administrada | Sí |
| Soporte para borrado / portabilidad | API o proceso documentado para devolver/borrar datos al fin del contrato | Sí |
| Histórico de incidentes | Sin breach material declarado en últimos 24 meses, o con remediación pública verificable | No bloqueante por sí solo, pero pondera |
| Roadmap de auditoría | Ofrece SOC 2 reciente bajo NDA o resumen público | No bloqueante; sí pondera para tier crítico |
| Costo / escalabilidad | Compatible con el modelo financiero del MVP | No bloqueante (gating financiero del PO) |

**Proceso**:

1. Owner candidato propone el vendor en ticket interno con justificación técnica.
2. DPO + Tech Lead revisan contra los criterios anteriores.
3. Si hay datos personales involucrados, el DPO valida con el abogado externo de LEG-001 antes de firmar.
4. Owner añade fila a §2 con `Status DPA = 🟡 pendiente` antes de la firma; al firmar lo cambia a ✅ y archiva PDF en 1Password vault `Compliance`.
5. PO ejecuta el flujo de aviso a clientes (§4) si el vendor toca datos productivos.

---

## 4. Cambios y aviso a clientes

### 4.1 Política

Cualquier alta, baja o cambio material (residencia, alcance, certificación) de un sub-procesador en §2.1 se notifica a Hospitales MAC con **mínimo 30 días naturales de anticipación**.

### 4.2 Canales de notificación

- Email firmado al contacto contractual de Hospitales MAC + DPO MAC.
- Actualización de la página pública `https://segurasist.app/privacy/subprocessors` (planeado en LEG-001).
- Bump de versión en el changelog del Aviso de Privacidad publicado.

### 4.3 Derecho de objeción del cliente

Hospitales MAC puede objetar la incorporación de un nuevo sub-procesador dentro del periodo de 30 días, conforme a la cláusula de sub-procesadores del DPA. En caso de objeción razonable (ej. el sub-procesador tiene historial de breaches no remediados, está en jurisdicción no aceptable), SegurAsist propondrá alternativa o, en último caso, el cliente puede rescindir conforme al contrato marco.

### 4.4 Excepción: cambio urgente por seguridad

Si la incorporación de un sub-procesador es necesaria para responder a un incidente activo (ej. WAF de emergencia), se notifica simultáneamente al cliente y se documenta en el post-mortem (ver `IRP.md` §3.8). El plazo de 30 días no aplica en ese caso, conforme a la cláusula de medidas urgentes.

---

## 5. Auditorías

### 5.1 Revisión anual

Cada sub-procesador productivo (§2.1) se revisa anualmente. Owner interno ejecuta los siguientes pasos y archiva evidencia en 1Password vault `Compliance/audits-<año>`:

- [ ] Recolectar reporte SOC 2 Type II más reciente bajo NDA (típicamente requiere portal del vendor o contacto comercial).
- [ ] Verificar vigencia de ISO/IEC 27001 si aplica.
- [ ] Revisar página de status histórico (`status.<vendor>.com`) por incidentes mayores en los últimos 12 meses.
- [ ] Verificar `Trust Center` o equivalente del vendor: cambios en alcance, sub-procesadores anidados.
- [ ] Confirmar que el DPA sigue vigente (algunos vendors actualizan términos unilateralmente — capturar versión).
- [ ] Documentar en la columna "Último review" de §2.1 con fecha del review.

### 5.2 Revisión inmediata por trigger

Se ejecuta una revisión adicional fuera de calendario cuando:

- El vendor publica un breach disclosure que pueda afectar a SegurAsist o a Hospitales MAC.
- El vendor cambia residencia de datos.
- El vendor pierde una certificación crítica (downgrade SOC 2, expiración de ISO 27001 sin renovar).
- El vendor es adquirido por otra entidad con jurisdicción distinta.

Cualquiera de estos triggers escala automáticamente a P1 conforme al `IRP.md` §2.

### 5.3 Reporte anual a Hospitales MAC

PO entrega un resumen ejecutivo anual con:

- Lista actualizada de sub-procesadores.
- Cambios desde el último reporte.
- Incidentes relevantes en cualquiera de ellos.
- Resultado de la revisión anual (cualquier vendor en watchlist).

---

## 6. Data flows

> Diagrama ASCII del flujo de datos productivos. PHI/PII se concentran en AWS (mx-central-1 primaria). Sub-procesadores fuera de AWS no tocan PHI por diseño.

### 6.1 Flujo principal — admin sube batch de asegurados

```
                  [Operador MAC]
                        |
                        | HTTPS (TLS 1.2+, cookies httpOnly sa_session)
                        v
              +----------------------+        +-------------------+
              | Amplify (admin)      |  --->  | App Runner (API)  |
              | mx-central-1         |        | mx-central-1      |
              +----------------------+        +-------------------+
                                                       |
                                +----------------------+----------------------+
                                |                      |                      |
                                v                      v                      v
                         +--------------+      +---------------+      +---------------+
                         | Cognito      |      | RDS Postgres  |      | S3 (uploads)  |
                         | (admin pool) |      | RLS tenant_id |      | mx-central-1  |
                         | mx-central-1 |      | mx-central-1  |      | KMS SSE       |
                         +--------------+      +---------------+      +---------------+
                                                       |                      |
                                                       v                      v
                                              +---------------+      +---------------+
                                              | S3 audit      |      | Worker Lambda |
                                              | Object Lock   |      | parse XLSX    |
                                              | (Sprint 5)    |      | + magic bytes |
                                              +---------------+      +---------------+
                                                                            |
                                                                            v
                                                                   +-------------------+
                                                                   | RDS (insureds)    |
                                                                   | + audit_log       |
                                                                   +-------------------+
```

### 6.2 Flujo certificado — envío al asegurado

```
[Worker emisor] -> S3 certificates (Object Lock S5) -> SES mx-central-1 -> Asegurado
                                                              |
                                                              v
                                                     SNS bounces/complaints
                                                              |
                                                              v
                                                       Lambda clasifica
```

### 6.3 Flujo chatbot (Sprint 4)

```
[Asegurado en portal] -> Amplify portal -> App Runner /v1/chat
                                                  |
                                                  | HTTPS + bearer (Cognito insured)
                                                  v
                                          Anthropic Claude API (US)
                                                  |
                                                  v
                                          Respuesta enriquecida
                                          (sin PHI por design;
                                           prompt restringido a
                                           catálogo público y FAQs)
```

### 6.4 Quién toca PHI vs PII vs nada

| Sub-procesador | PHI | PII (CURP/RFC/contacto) | Sesión / Audit | Logs sanitizados | Ninguno |
|---|---|---|---|---|---|
| AWS (RDS, S3, Cognito, SES, CloudWatch, KMS) | ✅ | ✅ | ✅ | ✅ | — |
| GitHub | — | — | — | — | ✅ (código + Actions logs sin PII por scrub) |
| Anthropic | — | — (por design) | — | — | ✅ (mensajes del chat sin PHI por design) |
| UptimeRobot | — | — | — | — | ✅ (solo pings a healthchecks públicos) |
| PagerDuty | — | — | — | — | ✅ (solo email/SMS del on-call) |
| 1Password | — | — | — | — | ✅ (credenciales del equipo, no de asegurados) |
| Sentry/Datadog (planeado) | — | — | — | ✅ (logs ya scrub-eados en `pino`) | — |

### 6.5 Transferencias internacionales

| Origen | Destino | Datos | Base legal |
|---|---|---|---|
| mx-central-1 | us-east-1 | Snapshot replicación cross-region (audit, certificates, exports — Sprint 5) | DPA AWS (cláusulas tipo) + Aviso de Privacidad publicado |
| mx-central-1 | us-east-1 | Servicios globales obligatorios (CloudFront, Route 53, ACM-for-CloudFront, IAM) | Idem |
| Cliente (browser) | mx-central-1 | TLS 1.2+ end-to-end | n/a (es el flujo principal) |
| Portal asegurado | Anthropic (US) | Mensajes del chat sin PHI | Anthropic DPA + consentimiento del asegurado en banner de chat |

> **Residencia primaria en México** es una mejora frente al diseño original (`us-east-1`). Documentado en ADR-014. Reduce la transferencia internacional a casos estrictamente necesarios por arquitectura AWS o por servicio (CloudFront/Route 53/IAM globales).
