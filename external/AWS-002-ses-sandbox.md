# AWS-002 — SES: salida de sandbox + dominio verificado

**Estado:** ⬜ Pendiente
**Bloquea:** F3 Certificados (envío real a asegurados)
**Owner:** DevOps + PO (caso de uso)
**Referencia:** `MVP_06_DevOps_IaC_SegurAsist.docx` §2.2 + `MVP_04_Backend_NestJS_SegurAsist.docx` §7.3
**Urgencia:** Solicitar el día D-5 del Sprint 0 (la aprobación de AWS toma 24-48h)

## Contexto

SES (Simple Email Service) por default está en **modo sandbox**: solo permite enviar a direcciones verificadas y máximo 200 emails/día. Necesitamos:

1. Salir de sandbox para enviar a asegurados reales (estimado ~10k/mes año 1).
2. Verificar dominio `segurasist.app` (DKIM + SPF + DMARC).
3. Configurar Configuration Set para tracking de bounces/complaints.

## Pasos

### 1. Solicitar salida de sandbox (cuenta `prod`, región `mx-central-1`)

- Consola SES → Account dashboard → "Request production access".
- **Mail Type:** Transactional
- **Website URL:** https://segurasist.app
- **Use case description** (copiar/adaptar):
  > SegurAsist is a SaaS platform for health insurance membership administration in Mexico. We send transactional emails to insured members containing their membership certificates (PDF attachment with signed metadata) at the moment of enrollment, after each renewal, and on-demand from their portal. Estimated volume: ~10,000 emails/month in year 1, scaling to ~30,000/month in year 3. Recipients are insured members of Hospitales MAC who have explicitly enrolled in the membership and consented to receive their certificate via email per LFPDPPP (Mexican federal data protection law). We do NOT send marketing or promotional emails. Bounce/complaint handling: SES events are delivered via SNS to a Lambda that classifies hard bounces as invalid and pauses sending if complaint rate exceeds 0.1%. We comply with CAN-SPAM and LFPDPPP.
- **Additional contacts:** PO + CISO emails.
- **Expected volume:** 10,000 emails/day peak.

### 2. Verificar dominio `segurasist.app`

- SES → Verified identities → "Create identity" → "Domain" → `segurasist.app`.
- **Habilitar DKIM** (Easy DKIM, RSA 2048).
- AWS provee 3 registros CNAME a publicar en Route 53 (zona pública).
- Esperar a que SES marque "Verified" (1-72h, normalmente <30 min).

### 3. Publicar SPF + DMARC en Route 53

| Tipo | Nombre | Valor |
|---|---|---|
| TXT | `segurasist.app` | `"v=spf1 include:amazonses.com -all"` |
| TXT | `_dmarc.segurasist.app` | `"v=DMARC1; p=quarantine; rua=mailto:dmarc@segurasist.app; pct=100; aspf=s; adkim=s"` |

> Empezar con `p=quarantine` por 30 días, luego `p=reject` cuando estabilicemos reputación.

### 4. Crear Configuration Set `segurasist-prod`

- SES → Configuration sets → "Create".
- **Event destinations:** SNS topic `ses-events` (suscripción en Lambda Worker Email).
- **Reputation tracking:** ON.
- **TLS:** Required.

### 5. Domain dedicado (opcional, recomendado producción)

Para 10k+ emails/mes, considerar un **dedicated IP** ($24.95/mes) o **dedicated IP pool** para aislar reputación de otros tenants futuros (SNTE, CATEM). Discutir con CISO y Roy en Sprint 5.

### 6. Warm-up plan (primeras 4 semanas)

- Día 1–7: 100 emails/día
- Día 8–14: 500 emails/día
- Día 15–21: 2,000 emails/día
- Día 22–30: capacidad plena

Esto evita penalizaciones por reputación al saltar de 0 a 10k overnight.

## Evidencia esperada

- [ ] Status "Production access granted" en SES dashboard
- [ ] `segurasist.app` con DKIM verified
- [ ] SPF + DMARC publicados (verificar con `dig TXT segurasist.app`)
- [ ] Configuration set `segurasist-prod` con SNS event destination

## Riesgo si no se hace a tiempo

Sin salida de sandbox, **no podemos enviar certificados a asegurados reales**. La demo del Sprint 2 puede usar emails verificados manualmente, pero el Go-Live (día 30) está bloqueado.

## Costo

- SES outbound: $0.10/1,000 emails (≈ $1/mes para 10k emails).
- Si dedicated IP: +$24.95/mes.
