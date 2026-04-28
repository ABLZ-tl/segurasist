# RB-007 — Audit pipeline degraded

- **Severity**: P1 (compliance critical — Object Lock S3 silent gap)
- **On-call SLA**: acknowledge ≤ 15 min, resolve ≤ 4 h
- **Owner**: DevOps on-call + Backend Audit Lead + Compliance Officer
- **Triggered by** (any of):
  - `segurasist-{env}-audit-writer-degraded`
    (`SegurAsist/Audit/AuditWriterHealth Avg < 1`)
  - `segurasist-{env}-audit-mirror-lag`
    (`SegurAsist/Audit/MirrorLagSeconds Max > 60s`)
  - `segurasist-{env}-lambda-audit_export-errors` (Errors > 0)
- **Related**: RB-013 (audit chain tampering), C-10 (chain verifier),
  H-01/H-02 (audit infra refactor)

## Symptom

- AuditWriter SLI < 1: writes a `audit_logs` PG ok pero el
  push a S3 mirror falla o late.
- `MirrorLagSeconds` > 60s sostenido → ChainVerifier "light path"
  (`source='both'`) puede pasar tampering silencioso (cierre C-10).
- Lambda `audit-export` Errors > 0 → mensual export a S3 audit no corre,
  Object Lock retention 24 m queda inconsistente.

## Detection

| Source | Metric |
|---|---|
| CloudWatch (custom) | `SegurAsist/Audit AuditWriterHealth Avg < 1` |
| CloudWatch (custom) | `SegurAsist/Audit MirrorLagSeconds Max > 60s` |
| CloudWatch | `AWS/Lambda Errors` para `segurasist-{env}-audit-export` |
| Pino logs API | `[audit-writer] degraded: <reason>` |
| S3 audit bucket | `aws s3 ls s3://segurasist-{env}-audit-*/` deltas |

## Triage (≤ 5 min)

1. Identificar qué alarm triggered (writer / mirror / lambda):
   - **AuditWriter degraded** → problema sincrónico al hacer write
     (RDS lock, KMS revoked, S3 PutObject 403). Alta gravedad: nuevos
     writes pueden estar perdiéndose o quedando sólo en PG.
   - **Mirror lag** → writes ok en PG pero el async push a S3 está
     atrás. Aún se puede recuperar (no hay data loss yet).
   - **Lambda audit-export errors** → export mensual fallando. No
     bloquea writes, pero compliance gap inminente si se pierde la
     ventana de 24m Object Lock.
2. Confirmar con `aws logs tail /aws/lambda/segurasist-{env}-audit-export --since 1h`
   o equivalente para AuditWriter.

## Mitigation — AuditWriter degraded

1. **Stop writes que dependan de audit chain** si SLI < 0.5:
   - Setear feature flag `AUDIT_BLOCKING=true` (forzar write a fallar
     si audit no logra grabar) → mejor caída fail-closed que
     compliance gap.
2. **Diagnóstico común**:
   - **KMS key revoked / pending deletion** (`kms_audit` key):
     ```bash
     aws kms describe-key --key-id alias/segurasist-{env}-audit
     ```
     Si `KeyState=PendingDeletion` → cancel pending deletion.
   - **S3 PutObject 403**: check IAM role App Runner instance — debe
     tener `s3:PutObject` + `kms:GenerateDataKey` para `kms_audit`.
   - **Object Lock retention violado** (intentando overwrite versión
     locked): el bug está en código, NO bypass — investigar y
     parchear emisor.
3. **Manual S3 sync** (catch-up):
   ```bash
   ./scripts/audit-mirror-catchup.sh --since '1h'
   ```
   (script en `segurasist-infra/scripts/`; lee desde PG `audit_logs`
   donde `mirrored_at IS NULL` y hace S3 PutObject batched).

## Mitigation — Mirror lag

1. **Validar Lambda mirror** (si pipeline vía Lambda):
   ```bash
   aws lambda get-function-configuration --function-name segurasist-{env}-audit-mirror
   ```
2. Si la cola intermedia (SQS `audit-mirror`) tiene backlog >> 100,
   escalar workers (reserved_concurrency + max receives).
3. Si lag persiste con cola vacía → bug en pipeline emitter; rollback
   al último deploy del módulo audit.

## Mitigation — Lambda audit-export errors

1. Replay manual: `aws lambda invoke --function-name segurasist-{env}-audit-export /tmp/out.json`
   con payload del schedule cron.
2. Common causes:
   - **EventBridge schedule disabled**: `aws events list-rules` →
     verify rule habilitada.
   - **S3 bucket policy drift**: re-aplicar `terraform apply` sólo
     `module.s3_audit`.
   - **Cognito list-users API throttled** (export incluye user list):
     ver RB-006 / Cognito throttle alarm.

## Root cause investigation

- Cross-link C-10: si AuditWriter health degrada DURANTE escritura
  de chain hash → riesgo de chain split. Run chain verifier full
  (NO el light path) sobre últimos 1000 logs y comparar.
- Si discrepancy aparece → escalar inmediatamente a **RB-013
  (audit-tampering)**.

## Postmortem checklist

- [ ] # writes degradados / perdidos (PG count vs S3 delta).
- [ ] Compliance impact (Object Lock retention mantenida?).
- [ ] Customer comms requerido? (audit gap > 1h en prod = sí, notificar
      CISO + legal).
- [ ] Action items: alarm earlier? AuditWriter circuit-breaker?
- [ ] Update audit dashboard (SLI gauge).
