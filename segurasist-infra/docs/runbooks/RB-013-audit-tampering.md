# RB-013 — Audit chain tampering detected

- **Severity**: P1 (security incident — privileged threat)
- **On-call SLA**: acknowledge ≤ 10 min, **freeze prod ≤ 30 min**,
  forensic capture ≤ 2 h
- **Owner**: DevOps on-call → CISO → Compliance Lead → Legal
- **Triggered by**: CloudWatch alarm
  `segurasist-{env}-audit-chain-tampering`
  (`SegurAsist/Audit/AuditChainValid Min < 1`)
- **Related**: RB-007 (audit degraded), C-10 (chain verifier full SHA),
  C-01 (Certificate.hash), H-01 (audit infra refactor)
- **NEW** — gatillado por chain verifier discrepancy de C-10.

## What this means

`AuditChainValid` es la métrica emitida 1×/hora por el cron
`AuditChainVerifierService.runVerification(source='both')`. Vale `1`
mientras el SHA-256 recomputado de cada `audit_logs` row coincide con
el `prev_hash` de la siguiente entrada Y con el mirror NDJSON en S3.

**Cualquier datapoint < 1 es evidencia de tampering** — no hay falso
positivo "esperado": el verifier tras C-10 fix recomputa SHA completo
(no sólo encadena `prev_hash`), por lo que sólo escapa silencioso si:
1. Bug en el verifier (poco probable post-C-10 + tests).
2. Mutación coordinada de `payloadDiff + row_hash + prev_hash + S3
   mirror` — lo que requiere acceso privilegiado a RDS BYPASSRLS +
   KMS audit key + S3 audit bucket. Esto **es** tampering.

## Symptom

- Alarm fires con `Source: 'both' | 'pg' | 's3'` indicando dónde está
  la discrepancia.
- Endpoint `GET /v1/audit/verify-chain` devuelve `valid: false` con
  array `discrepancies`.
- Posibles co-síntomas: usuarios sospechosos (BYPASSRLS recently),
  KMS audit key access logs anómalos, S3 audit bucket
  `RestoreObject` calls.

## Triage (≤ 10 min) — **NO BORRAR EVIDENCIA**

1. **NO refrescar la métrica**: la alarma debe quedar ON hasta que el
   forensic dump esté completo. NO ejecutar `verify-chain` re-run.
2. Confirmar el incidente:
   ```bash
   curl -H "Authorization: Bearer <admin-jwt>" \
     https://api.{env}.segurasist.app/v1/audit/verify-chain?source=both
   ```
   Si devuelve `discrepancies.length > 0` → confirmar.
3. **Notificar inmediatamente**:
   - CISO (PagerDuty escalation P1-Security).
   - Compliance Officer (LFPDPPP + ISO 27001 incident clock starts).
   - Legal Lead (potencial breach notification ≤ 72h LFPDPPP art. 20).

## Containment (≤ 30 min) — **FREEZE PROD**

1. **Block all writes** en App Runner — set feature flag global:
   ```bash
   aws apprunner update-service \
     --service-arn <prod-service-arn> \
     --runtime-environment-variables READ_ONLY_MODE=true
   ```
   En el código backend, `ReadOnlyGuard` debe rechazar 503 cualquier
   `POST/PATCH/PUT/DELETE` mientras `READ_ONLY_MODE=true`.
2. **Revoke sospechoso BYPASSRLS access**:
   - Listar conexiones recientes con role privileged:
     ```sql
     SELECT pid, usename, client_addr, query_start, state, query
     FROM pg_stat_activity
     WHERE usename IN (SELECT rolname FROM pg_roles WHERE rolbypassrls);
     ```
   - `pg_terminate_backend(pid)` para todos los pids sospechosos.
3. **Rotate KMS audit key** (force re-encrypt en deployment subsiguiente):
   ```bash
   aws kms create-grant --key-id alias/segurasist-prod-audit ... # only forensic role
   aws kms disable-key --key-id alias/segurasist-prod-audit-OLD-rotation
   ```
4. **Revoke Cognito sessions admin pool**:
   ```bash
   aws cognito-idp admin-global-sign-out --user-pool-id <admin-pool> --username <suspect>
   ```

## Forensic capture (≤ 2 h)

1. **Dump audit_logs PostgreSQL**:
   ```bash
   pg_dump -h <prod-rds> -U <forensic-readonly> \
     --table audit_logs \
     --data-only --column-inserts \
     --file /forensic/audit_logs_$(date +%s).sql
   sha256sum /forensic/audit_logs_*.sql > /forensic/dump_hashes.txt
   ```
2. **Dump S3 audit mirror** (snapshot completo):
   ```bash
   aws s3 sync s3://segurasist-prod-audit-<account>/ \
     /forensic/s3-audit-snapshot/ \
     --request-payer requester
   ```
   El bucket tiene Object Lock COMPLIANCE 24m → versiones inmutables;
   esto es la **fuente de verdad** vs PG.
3. **Compare hashes row-by-row**:
   - Para cada `audit_log_id`: compute SHA-256 del row PG → comparar
     con S3 NDJSON.
   - Identificar cuál fuente fue mutada (PG, S3, o ambas
     coordinadamente — última implica acceso doble).
4. **Capture CloudTrail** últimas 24 h para:
   - `kms:Decrypt` con `kms_audit` key.
   - `s3:DeleteObject` / `s3:PutObject` en bucket audit.
   - `rds:ExecuteStatement` desde IPs no-VPC.
5. **Lock forensic evidence** en bucket separado (S3 Glacier + Object
   Lock 7 años, COMPLIANCE mode, MFA delete on).

## Communication

1. **Internal** (≤ 1 h): #incidents Slack canal con timeline.
2. **CISO → CTO → CEO** (≤ 2 h): briefing de impacto.
3. **Customer comms (Hospitales MAC)** (≤ 24 h): solo hechos confirmados,
   no especulación. Plantilla en
   `docs/runbooks/RB-010-irp-triage-p1.md` → breach-notification-template.
4. **Regulator** (≤ 72 h LFPDPPP / GDPR si aplica): coordinar con
   Legal. NO comunicar antes de tener forensic capture inmutable.

## Recovery

- **Sólo después de forensic capture completa** + root cause identificado:
  - Restore desde último S3 mirror íntegro (cross-check con CRR
    DR copy en us-east-1).
  - PITR RDS al timestamp pre-tampering.
  - Re-run chain verifier post-restore para confirmar `valid: true`.
- Liberar `READ_ONLY_MODE=false` SOLO con sign-off CISO + Compliance.

## Postmortem checklist

- [ ] Threat actor identificado (interno / externo / ambos).
- [ ] Vector: BYPASSRLS abuso? KMS access? S3 IAM drift?
- [ ] Customer impact: # tenants afectados, alcance del data loss.
- [ ] Regulatory disclosure timeline (LFPDPPP + ISO 27001 + cliente
      Hospitales MAC contractual).
- [ ] Action items HIGH priority (≤ 30 d):
  - [ ] H-14 (BYPASSRLS audit) acelerado.
  - [ ] Dual-control para mutaciones audit (2-of-N approval).
  - [ ] Continuous chain verification (cada 5 min vs 1 h).
- [ ] Update RB-013 con la nueva clase de attack si emerge un patrón.
