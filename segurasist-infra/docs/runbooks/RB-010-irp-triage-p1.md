# RB-010 — IRP Triage (P1 — confirmed breach / unauthorized PII access)

- **Severity**: P1
- **On-call SLA**: acknowledge ≤ 15 min, contain ≤ 1 h, customer comms
  ≤ 72 h (LFPDPPP México art. 64 + GDPR-equivalent if EU subjects)
- **Owner**: CISO + Tech Lead + DevOps Lead (war-room conjunto)
- **Compliance**: ISO 27001 A.16, LFPDPPP art. 19/63/64, NIST SP 800-61
  rev2

> Este runbook es la entrada operacional al
> [`docs/security/IRP.md`](../../docs/security/IRP.md). RB-010 cubre las
> primeras 4 horas (Phase 1 + Phase 2 detection/triage del NIST
> framework). Phase 3+ (containment, eradication, recovery) se delega al
> IRP completo.

## Symptom

Cualquiera de los siguientes triangulado por **al menos 2 fuentes
independientes**:

- GuardDuty CRITICAL finding del tipo
  `Persistence:IAMUser/AnomalousBehavior`,
  `Exfiltration:S3/AnomalousBehavior`,
  `UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration`.
- Audit log internal (`audit_log` Postgres + S3 mirror) con eventos
  `read.exported` o `data.export.completed` cross-tenant
  (`actor.tenantId !== resource.tenantId` y el actor NO es
  `admin_segurasist`).
- Customer report: ticket Tier-1 escalado mencionando "vi datos de otro
  tenant" o "mi certificado tiene nombre/CURP de otra persona".
- WAF + ALB logs: spike de 4xx/5xx en endpoints PII (`/v1/insureds/*`,
  `/v1/certificates/*`) desde una IP/ASN nuevo.
- Auditoría externa: pentester, bug bounty, regulator.

**NO es P1** (escalar a P2 / RB correspondiente):

- Findings GuardDuty MEDIUM/LOW sin corroboración.
- 401/403 normales (los emite la app — esperado).
- Cross-tenant attempt en `cross-tenant.spec.ts` corriendo en CI (no
  prod).

## Detection

Dashboards de triage (orden de prioridad):

1. **CloudWatch dashboard `irp-detection-p1`**: GuardDuty CRITICAL +
   audit anomalies + WAF block rate.
2. **Audit log query (Postgres)**:
   ```sql
   SELECT al.id, al.actor_id, al.tenant_id, al.action, al.resource_type,
          al.resource_id, al.ip, al.created_at
   FROM audit_log al
   WHERE al.created_at > NOW() - INTERVAL '24 hours'
     AND al.action IN ('read.exported', 'data.export.completed', 'read.viewed')
   ORDER BY al.created_at DESC LIMIT 200;
   -- cross-tenant trip:
   SELECT al.* FROM audit_log al
   JOIN insureds i ON i.id = al.resource_id
   WHERE al.tenant_id <> i.tenant_id
     AND al.action LIKE 'read%'
     AND al.created_at > NOW() - INTERVAL '24 hours';
   ```
3. **S3 audit-logs bucket**: comparar el NDJSON immutable contra
   Postgres mutable — discrepancias = tampering. Endpoint
   `/v1/audit/verify-chain?source=both` lo automatiza (rate limit 2/min
   por H-02 — usa CLI BYPASSRLS para análisis batch).
4. **VPC Flow Logs**: tráfico saliente desde la VPC API hacia IPs no
   conocidas (S3 cross-region exfil tipico).
5. **GuardDuty findings JSON**:
   ```bash
   aws guardduty get-findings \
     --detector-id <DetectorId> \
     --finding-ids $(aws guardduty list-findings \
       --detector-id <DetectorId> \
       --finding-criteria '{"Criterion":{"severity":{"Gte":7}}}' \
       --query 'FindingIds' --output text)
   ```

## Diagnosis

> Phase 2 (Detection & Analysis) del IRP.

1. **Triangular fuentes**: la regla de 2-fuentes-independientes evita
   activar P1 por un único finding flaky. Si solo hay 1 fuente, escalar
   a P2 con investigación (RB correspondiente).
2. **Determinar alcance**:
   - ¿Qué tenants? Lista de `tenant_id` afectados.
   - ¿Qué subjects (insureds)? Lista de `cognito_sub` / `curp`.
   - ¿Qué tipos de dato? Certificados (PII), claims (PII médica), batch
     CSVs (PII bulk), audit logs (metadata).
   - Volumen: # filas exfiltradas o # certificados leídos.
3. **Vector entry**: ¿credencial Cognito comprometida? ¿IAM key leak?
   ¿RCE en API? ¿RLS bypass? ¿Cliente legítimo con permisos elevados
   indebidamente (ver H-14)?
4. **Lateral movement**: ¿el actor tocó otros recursos? VPC Flow Logs +
   CloudTrail.
5. **Persistence**: ¿plantó backdoor? Diff `iam:list-users`,
   `iam:list-roles`, `cognito-idp list-users` contra baseline diario.
6. **Exfiltration**: S3 GET requests cross-region anómalos.

Capturar TODO en `incidents/<YYYY-MM-DD>-<short-id>/triage.md` (commit
en `segurasist-infra`).

## Recovery

> Phase 3-5 del IRP — ver
> [`docs/security/IRP.md`](../../docs/security/IRP.md) Phases
> 3 (Containment), 4 (Eradication), 5 (Recovery).

### Containment (≤ 1 h)

1. **Disable la credencial sospechosa**:
   - Cognito user → `admin-disable-user` + `admin-user-global-sign-out`.
   - IAM user → `aws iam update-access-key --status Inactive` + revoke
     console access.
2. **WAF block** la IP/ASN ofensora (`aws wafv2 update-ip-set` con la
   regla `IRP-Block-<IncidentId>`).
3. **RDS read-replica off** si la sospecha es exfil masivo (asegura
   que no pueden seguir leyendo durante triage).
4. **S3 bucket policy DENY** temporal a la IP/ASN ofensora.
5. **Notificar war-room**: Slack `#sec-incident-<IncidentId>` con
   CISO + Tech Lead + DevOps Lead. Snapshot de evidence en bucket
   forense `s3://segurasist-forensics/<IncidentId>/`.

### Eradication / Recovery — ver IRP.md

Pasos detallados de:

- Rotación de credenciales (RB-009 si toca CMKs).
- Re-issue certificados afectados.
- Patch de la vulnerabilidad raíz.
- Restore desde backup pre-incidente si hubo tampering en DB
  (RB-008-rds-pitr-restore).

## Customer comms / Breach notification (≤ 72 h)

Si los datos exfiltrados / accedidos sin autorización incluyen PII de
sujetos identificables (CURP, RFC, email, nombre completo, datos
médicos):

1. **Notificación al regulador**:
   - LFPDPPP México (INAI): art. 64 — máx. 72 h tras conocimiento del
     incidente (mismo timing que GDPR).
   - Plantilla en `docs/security/breach-notification-template.md`.
2. **Notificación al cliente B2B (tenant)** afectado: Slack/email
   directo del Tech Lead + CISO. Detalle: alcance, vector, mitigación.
3. **Notificación a sujetos** (si el cliente B2B no toma responsabilidad
   primaria): vía email comunicado, plantilla en
   `docs/security/breach-notification-subject.md`.
4. **Comunicado público** (si >100 sujetos afectados o cliente
   solicita): aprobado por CISO + Legal antes de publicar.

## Postmortem template

Completar dentro de 7 días post-incidente. Plantilla en
`docs/security/postmortem-template.md`. Mínimo:

- **Timeline (UTC)**: T0 detección, T1 ack, T2 contention,
  T3 eradication, T4 customer comms, T5 close.
- **Root cause**: vector inicial + factor agravante.
- **Subjects affected**: count + tipo de PII.
- **Regulatory notifications**: regulator, fecha, número de tracking.
- **Action items** (owner, due date):
  - [ ] Test E2E que reproduzca el bug y prevenga regresión.
  - [ ] Detection rule en GuardDuty / WAF / audit log alarms.
  - [ ] Update RB / IRP si el playbook tuvo gap.
  - [ ] Revisión cruzada de endpoints similares (mismo patrón en otra
    feature).

## Métricas de tracking (anuales)

- # incidentes P1 / año (objetivo: 0).
- Tiempo medio acknowledge (objetivo: ≤ 15 min).
- Tiempo medio containment (objetivo: ≤ 1 h).
- Tiempo medio breach notification (objetivo: ≤ 24 h, far below el
  máximo regulatorio de 72 h).
- # falsos positivos P1 (objetivo: ≤ 2/año; >2 → tunear detección).

## Referencias

- [`docs/security/IRP.md`](../../docs/security/IRP.md) — full playbook
  Phases 1-6.
- [`docs/security/breach-notification-template.md`](../../docs/security/breach-notification-template.md).
- ISO 27001 Anexo A.16 — Information security incident management.
- LFPDPPP México art. 19, 63, 64 — Notificación de vulneraciones.
- NIST SP 800-61 rev2 — Computer Security Incident Handling Guide.
