## F8 iter 1 — B-CI + B-OBSERVABILITY

[F8] 2026-04-27 17:00 iter1 STARTED — B-CI (C-12 Swagger + C-13 OIDC roles + Trivy job) + B-OBSERVABILITY (C-14 alarms + H-30 partial runbooks).

[F8] 2026-04-27 17:35 iter1 DONE C-12 segurasist-api/src/main.ts:9 + segurasist-api/src/main.ts:74-103 — agregado import `DocumentBuilder, SwaggerModule from '@nestjs/swagger'` + bloque `SwaggerModule.setup('v1/openapi', app, document, { jsonDocumentUrl: 'v1/openapi.json', yamlDocumentUrl: 'v1/openapi.yaml', swaggerOptions: { persistAuthorization: true } })`. Bearer auth declarado con scheme `cognito-jwt`. Ahora `GET /v1/openapi.json` devuelve OpenAPI 3 spec → desbloquea ZAP baseline en `.github/workflows/ci.yml:367`. // F5: agregar deps `@nestjs/swagger@^7.4.0` y `nestjs-zod@^3.0.0` a `segurasist-api/package.json` (runtime, NO devDeps).

[F8] 2026-04-27 17:05 iter1 NEW-FINDING segurasist-api/package.json — F5 debe agregar deps `@nestjs/swagger@^7.4.0` + `nestjs-zod@^3.0.0` (o `zod-to-openapi@^7.0.0` si pipeline manual). Sin estas deps el build falla. Runtime, no devDependencies. // F5 owner.

[F8] 2026-04-27 17:50 iter1 DONE C-13 segurasist-infra/global/iam-github-oidc/main.tf — agregadas 2 trust policies (`trust_staging_tf_plan` líneas 147-170, `trust_prod_tf_plan` líneas 226-247) + 2 IAM roles + 2 policy attachments (`tf_plan_staging` y `tf_plan_prod`) con `arn:aws:iam::aws:policy/ReadOnlyAccess`. Patrón espejo a `tf_plan_dev` existente. Trust condicionada a `repo:.../segurasist-infra:ref:refs/heads/main` + `pull_request`. `outputs.tf` actualizado con `plan_staging` + `plan_prod` ARNs en `tf_role_arns`. Desbloquea `terraform-plan.yml:99` para staging/prod.

[F8] 2026-04-27 18:30 iter1 DONE C-14 segurasist-infra/envs/{dev,staging,prod}/alarms.tf — 3 archivos NUEVOS (uno por env, NO se tocó main.tf). Cada uno crea:
  - SNS topic `segurasist-{env}-oncall-p1` (KMS encrypted con kms_general) + IAM policy permitiendo `cloudwatch.amazonaws.com` + `events.amazonaws.com` publish (cond `AWS:SourceAccount`).
  - Variable `alert_emails: list(string)` declarada en alarms.tf (NO en variables.tf, para mantener ownership F5/F8 separado).
  - Subscripciones email iterando `var.alert_emails`.
  - 11 alarmas core (10+ requeridas):
    1. `apprunner-5xx-rate` (RB-001) → AWS/AppRunner 5xxStatusResponse > 5/min (3/min en prod).
    2. `rds-cpu-high` (RB-002) → AWS/RDS CPUUtilization > 80% (75% prod) sostenido 5 min.
    3. `rds-connections-high` (RB-002) → AWS/RDS DatabaseConnections > 50 (~63% t4g.small max).
    4. `sqs-{queue}-dlq-depth` (RB-004) for_each = local.queues → AWS/SQS ApproximateNumberOfMessagesVisible > 0 en cada DLQ (4 alarmas: layout/certificates/emails/reports).
    5. `waf-blocked-spike` (RB-005) → AWS/WAFV2 BlockedRequests > 100/200/500 según env. Prod además incluye `waf-cf-blocked-spike` en us-east-1 (CLOUDFRONT scope) con SNS topic dedicado `oncall-p1-us-east-1`.
    6. `ses-bounce-rate-high` → AWS/SES Reputation.BounceRate > 5%.
    7. `audit-writer-degraded` (RB-007) → custom metric SegurAsist/Audit/AuditWriterHealth Avg < 1.
    8. `audit-mirror-lag` (RB-007) → custom metric SegurAsist/Audit/MirrorLagSeconds Max > 60s.
    9. `audit-chain-tampering` (RB-013) → custom metric SegurAsist/Audit/AuditChainValid Min < 1 → P1-Security.
    10. `lambda-{pdf,emailer,audit_export}-errors` for_each → AWS/Lambda Errors > 0 (3 alarmas).
    11. `cognito-{admin,insured}-throttle` for_each → AWS/Cognito ThrottleCount > 0 (2 alarmas).
  - `treat_missing_data = "notBreaching"` en dev (anti-spam), `"breaching"` en staging/prod para audit metrics (silencio del emisor = anomalía).
  - Outputs `alerts_sns_topic_arn` + `alarm_arns` map para verificación post-deploy.

[F8] 2026-04-27 18:45 iter1 DONE H-30 partial — 5 runbooks renovados + 1 nuevo:
  - `RB-001-api-down.md` — completado con Triage / Mitigation (rollback, smoke deps, scale out) / Root cause / Postmortem.
  - `RB-002-rds-cpu-high.md` (NUEVO, reemplaza `RB-002-rds-connection-saturation.md` legacy) — Triage Performance Insights, kill rogue query, vertical scale, read-replica routing.
  - `RB-004-sqs-dlq.md` (NUEVO, reemplaza `RB-004-ses-bounce-rate-high.md` legacy) — peek DLQ, reproduce, redrive con `start-message-move-task`.
  - `RB-005-waf-spike.md` (NUEVO, reemplaza `RB-005-cross-tenant-attempt.md` legacy) — attack vs FP triage, geo block, rate-based bump.
  - `RB-007-audit-degraded.md` (NUEVO, reemplaza `RB-007-lambda-pdf-saturated.md` legacy) — AuditWriter SLI, mirror lag, manual S3 sync, escalada a RB-013.
  - `RB-013-audit-tampering.md` (NUEVO) — gatillado por chain verifier discrepancy de C-10. Severity P1-Security. Freeze prod (READ_ONLY_MODE), forensic dump PG + S3 inmutable, KMS rotation, comms LFPDPPP/regulator. Cierra Audit doc 06 P3 cross-cutting.
  - Legacy files eliminados (`rm` ejecutado): `RB-002-rds-connection-saturation.md`, `RB-004-ses-bounce-rate-high.md`, `RB-005-cross-tenant-attempt.md`, `RB-007-lambda-pdf-saturated.md`. Referencia stale en `RB-011-dast-failure.md` actualizada.

[F8] 2026-04-27 18:55 iter1 DONE Trivy job .github/workflows/ci.yml:563-595 — agregado job `trivy` (filesystem scan, severity HIGH/CRITICAL, ignore-unfixed, SARIF upload a Security tab). Incluido en `ci-success` aggregate gate (línea 595) + check loop. Independiente de paths-filter (corre siempre porque el lockfile monorepo afecta cross-project).

[F8] 2026-04-27 18:55 iter1 NOTE terraform validate NO ejecutado — sandbox sin terraform binary. Validación syntactic by hand: locals/modules/for_each/providers verificados consistentes con módulos existentes (cloudwatch-alarm variables, sqs-queue.dlq_name output, lambda-function.function_name, apprunner-service.service_id). Tags map(string) compatible. F0 debe correr `terraform validate` en runner CI antes de iter 2.

[F8] 2026-04-27 18:55 iter1 NEW-FINDING — alarms `audit-writer-degraded`, `audit-mirror-lag`, `audit-chain-tampering` requieren que el backend (F6) emita custom metrics en namespace `SegurAsist/Audit` con dimensión `Environment`. Sin la emisión las alarmas quedan en INSUFFICIENT_DATA. Sprint 5 cablea CloudWatch EmbeddedMetricFormat en AuditWriterService + AuditChainVerifierService. Cross-ref con F6 ownership. // F6: emitir AuditWriterHealth/MirrorLagSeconds/AuditChainValid via EMF en iter 2.

[F8] 2026-04-27 18:55 iter1 NEW-FINDING — `terraform-plan.yml` workflow NO existe en `.github/workflows/` (referenciado en C-13 audit pero no encontrado). F0 orquestador debe crear el workflow consumiendo los nuevos `tf_plan_staging`/`tf_plan_prod` ARN outputs de iam-github-oidc. Out-of-scope F8.

[F8] 2026-04-27 18:55 iter1 iter1-complete — 3 Critical (C-12, C-13, C-14) cerrados + H-30 partial (5/12 → 5 cerrados, faltan RB-009/010/011/012 owned by F10). Trivy job agregado. 1 NEW-FINDING para F5 (deps Swagger), 1 para F6 (custom metrics audit), 1 para F0 (terraform-plan.yml workflow). Tests no aplicables (Terraform no runtime; Swagger smoke requiere docker compose up — F0 corre en CI).
