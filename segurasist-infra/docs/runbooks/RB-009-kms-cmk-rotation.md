# RB-009 — Manual KMS CMK rotation

- **Severity**: P3 (planned maintenance) / P1 (compromise-driven)
- **SLA**: scheduled (annual) ≤ 2 h ventana de mantenimiento; ad-hoc
  (compromise-driven) acknowledge ≤ 30 min, complete ≤ 4 h
- **Owner**: DevOps Lead + CISO (sign-off conjunto)
- **Compliance**: ISO 27001 A.10.1.2, PCI 3.6.4, NIST SP 800-57 §5.2

> Aplica a CMKs custom (no `aws/*` AWS-managed keys) que cifran S3
> certificates bucket, S3 audit-logs bucket, RDS storage, EBS volumes
> de los workers, SES configuration set y cognito-idp PII custom
> attribute.

## Symptom / Trigger

Tres triggers válidos:

1. **Programado anual**: AWS Config rule
   `cmk-backing-key-rotation-enabled` reportó la CMK >365 días sin
   rotación de backing key. AWS-managed rotation NO aplica (las CMKs de
   este proyecto tienen `KeyRotation=false` para forzar control
   explícito sobre el material).
2. **Compromise indication**: GuardDuty finding del tipo
   `Stealth:IAMUser/CloudTrailLoggingDisabled`,
   `Discovery:IAMUser/AnomalousBehavior`, o key usage spike anómalo
   detectado por CloudWatch alarm `kms-decrypt-rate-exceeded`.
3. **Personal change**: Salida de un titular con acceso a la CMK
   (CISO, DevOps Lead) → política operativa exige rotación dentro de 7
   días.

## Detection

- AWS Config rule `cmk-backing-key-rotation-enabled` (CRITICAL si
  >365d).
- GuardDuty findings (CRITICAL → IRP triage RB-010).
- CloudWatch alarm `kms-decrypt-rate-exceeded` (10x baseline en 5
  min).
- Audit log interno: cualquier `kms:UpdateKeyDescription` o
  `kms:PutKeyPolicy` no firmado por la rotación planeada.

## Diagnosis

1. Identificar la CMK afectada:
   ```bash
   aws kms list-keys --region mx-central-1
   aws kms describe-key --key-id <KeyId>
   ```
2. Listar consumidores actuales (alias y resources que la usan):
   ```bash
   aws kms list-aliases --region mx-central-1 | jq '.Aliases[] | select(.TargetKeyId=="<KeyId>")'
   # S3 buckets que la usan:
   aws s3api list-buckets --query 'Buckets[].Name' --output text | \
     xargs -n1 -I{} sh -c 'aws s3api get-bucket-encryption --bucket {} 2>/dev/null | grep -l "<KeyId>"'
   # RDS instances:
   aws rds describe-db-instances --query 'DBInstances[?KmsKeyId==`<KeyArn>`].DBInstanceIdentifier'
   ```
3. Verificar quién ha usado la key recientemente (CloudTrail):
   ```bash
   aws cloudtrail lookup-events \
     --lookup-attributes AttributeKey=ResourceName,AttributeValue=<KeyArn> \
     --max-results 50 \
     --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S)
   ```
4. Si es compromise-driven, capturar evidence ANTES de rotar (ver
   RB-010).

## Recovery / Procedure

> ⚠️ **Doble firma obligatoria**: El operador ejecuta los pasos; el
> CISO verifica cada checkpoint vía Slack `#sec-ops` antes del
> siguiente.

### Camino A — Rotación programada anual

1. **Pre-flight (T-7 días)**:
   - Confirmar window de mantenimiento con stakeholders.
   - Backup metadata: `aws kms describe-key --key-id <Old> > old-key.json`.
   - Verificar que el alias actual NO está siendo usado por código
     hard-coded (`grep -r "key/<KeyId>" /Users/ablz/Documents/Claude/Projects/SegurAsist/SaaS/`).
2. **Crear nueva CMK** (T-0):
   ```bash
   aws kms create-key \
     --description "SegurAsist <purpose> CMK rotated <YYYY-MM-DD>" \
     --key-usage ENCRYPT_DECRYPT \
     --key-spec SYMMETRIC_DEFAULT \
     --policy file://kms-policy-<purpose>.json \
     --tags TagKey=Purpose,TagValue=<purpose> TagKey=RotatedFrom,TagValue=<OldKeyId>
   ```
3. **Re-encrypt los recursos**:
   - **S3 (certificates, audit-logs, exports)**: `s3 sync s3://bucket
     s3://bucket --sse aws:kms --sse-kms-key-id <NewKeyArn>` con
     versioning para rollback. Verificar que ningún object tiene la
     key vieja: `aws s3api list-objects --bucket … --query
     'Contents[?ServerSideEncryption!=`<NewKeyArn>`]'`.
   - **RDS**: snapshot de la instancia, copy-snapshot a la new key,
     restore-from-snapshot. Migrar las réplicas read.
   - **EBS workers**: snapshot, copy with new key, replace volumes.
   - **SES configuration set**: re-asociar el `KmsKeyId` con
     `update-configuration-set`.
   - **Cognito custom attributes**: si la PII estaba envuelta con la
     CMK vieja (no es el caso default; verificar `policy.json`).
4. **Update aliases**:
   ```bash
   aws kms update-alias --alias-name alias/<purpose> --target-key-id <NewKeyId>
   ```
5. **Validation tests** (ver §Validación abajo).
6. **Schedule old key for deletion** (≥7 días de pending; default 30):
   ```bash
   aws kms schedule-key-deletion --key-id <OldKeyId> --pending-window-in-days 30
   ```
7. **Documentar en `docs/security/kms-rotation-log.md`**.

### Camino B — Compromise-driven (urgent)

> Saltar el pre-flight programado. Evidence-first.

1. **Capture evidence**: CloudTrail dump completo de las últimas 24h
   asociadas a la key + GuardDuty finding JSON.
2. **Disable la key vieja INMEDIATAMENTE** (no rotación: bloqueo):
   ```bash
   aws kms disable-key --key-id <OldKeyId>
   ```
3. **Crear nueva CMK** y aliasarla (paso 2 + 4 del camino A).
4. **Re-encrypt** los recursos a-priori críticos PRIMERO (audit-logs >
   certificates > exports > el resto).
5. **Validar** y **re-habilitar** sólo los resources críticos.
6. Pasar a **RB-010 IRP Triage**: investigar alcance de exposición y
   notificación regulatoria si aplica.

## Validación post-rotación

- [ ] `aws kms describe-key --key-id <NewKeyId>` muestra `Enabled=true`.
- [ ] Smoke test certificates: emitir certificado de prueba en staging,
  verificar que `s3 head-object` reporta `<NewKeyArn>` como
  `ServerSideEncryption-Aws-Kms-Key-Id`.
- [ ] Smoke test audit log: nuevo evento audit, ver que el NDJSON en S3
  está envuelto con la new key.
- [ ] RDS connection desde la API + 1 query SELECT exitosa.
- [ ] `kms:Decrypt` rate normalizado en CloudWatch (5 min después).
- [ ] CloudTrail evento `KeyRotation` registrado por el operador con
  firma CISO en Slack.

## Postmortem / log

Completar y commitear en `docs/security/kms-rotation-log.md` con:

- **Date** (UTC)
- **Trigger**: scheduled / compromise / personnel
- **Old KeyId / New KeyId**
- **Resources re-encrypted**: bucket names, DB ARNs, EBS volume IDs.
- **Validation tests run**: lista
- **Time to complete** (T0 → validation OK)
- **Operator + CISO sign-off** (Slack thread URL)

## Métricas de tracking

- Tiempo medio de rotación programada (objetivo: <2 h).
- Tiempo medio de rotación compromise-driven (objetivo: <4 h).
- Frecuencia de rotación no-programada (objetivo: <1/año).
