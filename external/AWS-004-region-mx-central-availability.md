# AWS-004 — Verificar disponibilidad de servicios en mx-central-1

**Estado:** ⬜ Pendiente — **BLOQUEANTE para Sprint 1**
**Bloquea:** todo el provisioning de Terraform en `envs/dev/` y `envs/staging/`
**Owner:** DevOps Lead
**Depende de:** AWS-001 (cuenta `dev` activa)
**Referencia:** `ADR-014` (cambio de región primaria a México)

## Contexto

`mx-central-1` (AWS Mexico Region) es relativamente nueva. Aunque AWS la marca como GA, **algunos servicios pueden no estar disponibles inicialmente** o tener feature parity reducida. Antes de aplicar Terraform, hay que confirmar disponibilidad de los **9 servicios críticos** del stack.

Si un servicio falta, ya tenemos **plan B documentado** en cada caso. La verificación define si ejecutamos plan A o plan B en Sprint 1.

## Servicios a verificar — checklist

Para cada servicio:
1. Abrir [AWS Regional Services List](https://aws.amazon.com/about-aws/global-infrastructure/regional-product-services/) y filtrar por `mx-central-1`.
2. Confirmar disponibilidad de las **features específicas** que usamos (no solo el servicio "presente").
3. Marcar resultado abajo. Si falla, abrir issue y aplicar plan B.

| # | Servicio | Feature crítica | Plan A | Plan B | Estado |
|---|---|---|---|---|---|
| 1 | **App Runner** | servicio + VPC connector + auto-scaling | Backend NestJS desplegado en App Runner | Migrar a **ECS Fargate** (ADR-002 lo documenta como trivial). Mismo Dockerfile. | ⬜ |
| 2 | **Amplify Hosting** | monorepo support + custom domain + SSR | 2 apps Amplify (admin + portal) | **CloudFront + S3 + Lambda@Edge** o **CloudFront + Lambda Function URLs** (Next.js standalone) | ⬜ |
| 3 | **Cognito User Pools** | SAML federation + custom auth flows + MFA TOTP/WebAuthn | 2 user pools en mx-central-1 | Mantener pools en **us-east-1** (servicio multi-region; datos personales en EE.UU. requiere addendum DPA + notificar a MAC) | ⬜ |
| 4 | **SES** | dominio verificado + DKIM + Configuration Set + SNS event destination | SES en mx-central-1 con `segurasist.app` | SES en **us-east-1** (acepta sender domain en cualquier región, solo afecta endpoint API) | ⬜ |
| 5 | **RDS PostgreSQL** | engine 16.x + Multi-AZ + cross-region replica + Performance Insights | RDS PostgreSQL 16 Multi-AZ en mx-central-1 | Sin plan B real — si no está disponible, **bloquea todo el proyecto**. Notificar a Roy inmediatamente. | ⬜ |
| 6 | **Lambda** | Node.js 20 runtime + VPC + provisioned concurrency + container images | Workers Lambda en mx-central-1 | n/a (Lambda está en todas las regiones GA) | ⬜ |
| 7 | **ElastiCache Redis Serverless** | Serverless tier + encryption in-transit/at-rest | Redis Serverless en mx-central-1 | **ElastiCache Redis Cluster** standard (más caro, más operación) | ⬜ |
| 8 | **S3** | Object Lock COMPLIANCE + cross-region replication + KMS SSE | Buckets en mx-central-1 con Object Lock | n/a (S3 está en todas las regiones GA) | ⬜ |
| 9 | **GuardDuty + Security Hub + Config + Inspector** | delegación org-wide + CIS Benchmark v2.0 | Tooling en cuenta `security` agg desde mx-central-1 | Tooling en **us-east-1** agregando hallazgos de mx-central-1 (soportado nativamente) | ⬜ |

## Servicios SIEMPRE en us-east-1 (sin alternativa)

Estos NO van a mx-central-1 por diseño AWS — está esperado:

- **CloudFront** (servicio global, edge locations)
- **ACM para CloudFront** (cert obligatorio en us-east-1)
- **WAF scope CLOUDFRONT** (us-east-1)
- **Route 53** (servicio global)
- **IAM, Organizations, IAM Identity Center** (globales)
- **Shield, WAF Shield Advanced metrics**

Ya modelado en `segurasist-infra/global/route53/` con provider alias `aws.us_east_1`.

## Procedimiento de verificación rápida (10 minutos)

Desde la cuenta `dev` con CLI configurado:

```bash
export AWS_REGION=mx-central-1

# 1. App Runner
aws apprunner list-services --region mx-central-1
# si devuelve InvalidRegion / no devuelve: NO disponible

# 2. Amplify Hosting
aws amplify list-apps --region mx-central-1

# 3. Cognito
aws cognito-idp list-user-pools --max-results 1 --region mx-central-1

# 4. SES
aws sesv2 list-email-identities --region mx-central-1

# 5. RDS engine versions
aws rds describe-db-engine-versions --engine postgres --region mx-central-1 \
  --query 'DBEngineVersions[?starts_with(EngineVersion, `16.`)].EngineVersion'

# 6. Lambda Node.js 20
aws lambda list-runtimes --region mx-central-1 2>/dev/null || echo "use list-functions or check console"

# 7. ElastiCache Serverless
aws elasticache describe-serverless-caches --region mx-central-1

# 8. S3 Object Lock
aws s3api list-buckets --region mx-central-1  # solo confirma S3 disponible

# 9. GuardDuty
aws guardduty list-detectors --region mx-central-1
```

Si algún comando devuelve `InvalidRegion`, `EndpointConnectionError`, o `ServiceNotAvailable`, ese servicio NO está disponible.

## Plan de acción según resultado

### Caso A — todo disponible (ideal)
Aplicar Terraform tal como está. Sin cambios. Cerrar este ticket.

### Caso B — App Runner NO disponible
1. Editar `segurasist-infra/modules/apprunner-service/` → renombrar a `ecs-fargate-service/` (o crear nuevo módulo paralelo).
2. Actualizar `envs/*/main.tf` para usar el nuevo módulo.
3. ECS Fargate requiere ALB (ya pensado en SG `sg-alb`).
4. Backend Dockerfile no cambia.
5. Tiempo estimado: 1 día de DevOps.

### Caso C — Amplify Hosting NO disponible
1. Build Next.js con `output: 'standalone'`.
2. Subir build a S3 + invalidar CloudFront.
3. Para SSR: usar Lambda Function URL detrás de CloudFront.
4. Pipeline GitHub Actions cambia (no `aws amplify start-deployment`, sino `aws s3 sync` + `aws cloudfront create-invalidation`).
5. Tiempo estimado: 2 días.

### Caso D — Cognito NO disponible
1. Mantener User Pools en us-east-1.
2. Backend (App Runner en mx-central-1) habla a Cognito en us-east-1 vía endpoint regional.
3. **Addendum DPA**: notificar formalmente a MAC que datos de identidad/auth viven en US (ya cubierto por DPA AWS marco, solo notificación cortesía).
4. Tiempo estimado: 0.5 días + comunicación.

### Caso E — RDS PostgreSQL 16 NO disponible
**Escalada inmediata a Roy.** Sin RDS no hay producto. Opciones:
- Bajar a PostgreSQL 15 (verificar si está disponible).
- Pivote a Aurora Serverless v2 (también requiere disponibilidad).
- Pivote a `us-east-1` para RDS (rompe ADR-014, requiere aprobación de Roy/MAC).

## Evidencia esperada

- [ ] Output de los 9 comandos `aws ... list-*` documentado en `segurasist-infra/docs/runbooks/RB-012-region-availability-check.md`.
- [ ] Decisión final por servicio (Plan A o Plan B) registrada.
- [ ] Si algún Plan B se activa, ADR nuevo (ADR-015+) documentando.
- [ ] PROGRESS.md actualizado.

## Tiempo estimado

- Verificación: 30 min
- Si todo disponible: cerrar este ticket.
- Si hay Plan B: agregar 0.5–2 días al cronograma del Sprint 1 según el caso.
