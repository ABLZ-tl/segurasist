# ADR-014 — Región primaria mx-central-1 (México) por requerimiento del cliente

- Status: accepted
- Date: 2026-04-25
- Decision-makers: Tech Lead, DevOps Lead, CISO, PO, Roy (sponsor)
- Reference: Arquitectura SegurAsist §7.1 (ADR-001 SUPERSEDED en este punto), Plan Cumplimiento §control 3.9 (Datos · Ubicación de Datos)

## Contexto

El doc Arquitectura v1.0 cerró ADR-001: "100% AWS, región primaria `us-east-1`, DR `us-east-2`". El SKU premium contemplaba migrar a `mx-central-1` solo si MAC lo solicitaba explícitamente.

**Roy comunicó la solicitud de MAC**: residencia primaria de datos en territorio mexicano. Esto convierte el SKU "premium" en el SKU base del MVP.

## Decisión

**Región primaria: `mx-central-1`** (AWS Mexico Region, Querétaro/CDMX). DR: `us-east-1` (Virginia) — ver ADR-012.

Implicaciones:
1. Toda la infraestructura productiva se aprovisiona en `mx-central-1`: VPC, RDS, App Runner, Lambdas, SQS, EventBridge, S3, KMS, Secrets Manager, ECR, ElastiCache.
2. **Excepción 1 — ACM para CloudFront/Amplify**: AWS exige que el certificado ACM consumido por CloudFront resida en `us-east-1`. Mantenemos un cert ACM duplicado en us-east-1 con el mismo wildcard (módulo `global/route53/` ya implementa esto con `provider aws.us_east_1`).
3. **Excepción 2 — Servicios globales** (IAM, Organizations, Route 53, CloudFront, WAF scope CLOUDFRONT, Shield): no tienen "región" o se anclan a us-east-1 por diseño AWS.
4. **Verificar disponibilidad** de App Runner, Amplify Hosting, Cognito, SES, Bedrock en mx-central-1. Plan B documentado en `external/AWS-004`.

## Consecuencias

- **Cumplimiento**: control 3.9 V2 ("Ubicación de datos") pasa de "Si — primary US, DR US, premium MX" a "Si — primary MX, DR US". Mejora la postura LFPDPPP (transferencia internacional reducida solo a DR).
- **Costo**: estimación inicial +5–10% sobre baseline us-east-1 (mx-central-1 tiene precios ligeramente superiores en compute y RDS). Recalcular en `MVP_06 §11`.
- **Latencia**: usuarios MX a mx-central-1: ~5–20 ms (vs ~70 ms a us-east-1). **Mejor UX para asegurados.**
- **Disponibilidad de servicios**: riesgo de no tener todos los servicios disponibles inicialmente. Plan B obligatorio (ADR-014.1 si aplica).
- **DPA AWS**: sigue siendo válido, no requiere addendum (cobertura global).
- **Comunicación a MAC**: PO presenta el cambio como **mejora unilateral** del servicio en el próximo status semanal a Roy.

## Plan de migración

Como el bootstrap (Sprint 0) ya quedó hecho con esta región, no hay "migración" — es la región de arranque. Lo que sí hay es:

1. Verificación de disponibilidad de servicios en mx-central-1 (`external/AWS-004`).
2. Si **App Runner** no está disponible: pivote a **ECS Fargate** (ADR-002 ya documenta esto como migración trivial).
3. Si **Amplify Hosting** no está disponible: pivote a **CloudFront + S3 + Lambda@Edge** (más operación pero igual costo).
4. Si **Cognito** no está disponible: User Pools en `us-east-1` con datos personales en EE.UU. + addendum DPA. Notificar a MAC.

## Alternativas consideradas

- **Mantener us-east-1 primary + replica activa MX**: rechazado. Roy fue explícito en residencia primaria mexicana.
- **mx-central-1 sin DR cross-region**: rechazado. El MVP necesita RTO ≤4h y RPO ≤24h por contrato (RNF-AVA-02/03).
- **Esperar disponibilidad GA de servicios**: rechazado. Bloquea cronograma comprometido (Go-Live día 30).

## Tareas que dispara este ADR

- [ ] `external/AWS-004` — verificar disponibilidad de servicios en mx-central-1 (DevOps).
- [ ] `MVP_03_Arquitectura_SegurAsist.docx v1.1` — actualizar §1, §5, §7.1 para reflejar el cambio (PM en próxima iteración del doc).
- [ ] `MVP_06_DevOps_IaC_SegurAsist.docx v1.1` — recálculo de costos.
- [ ] `MVP_08_Seguridad_Cumplimiento_SegurAsist.docx` — control 3.9 actualizado.
- [ ] Recálculo de presupuesto AWS MXN/mes y comunicación a finanzas.
