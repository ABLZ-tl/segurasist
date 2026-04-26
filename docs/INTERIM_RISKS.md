# SegurAsist — Riesgos operativos vigentes (interim)

> Estado: vigente desde Sprint 1 hasta el cierre de Sprint 5.
> Owner: Tech Lead + DevOps.
> Última actualización: 2026-04-26.

Este documento captura los riesgos operativos que existen mientras el stack es
local-first y la infraestructura productiva todavía no se ha provisionado en
AWS. **Es complementario** a `docs/PROGRESS.md` y al plan de Sprint 5
(provisioning + endurecimiento + DR + pentest).

## TL;DR para incident response

Si ocurre un incidente de seguridad **antes** de que Sprint 5 cierre Object Lock
COMPLIANCE, asume que **la evidencia post-incidente puede haber sido alterada**.
Toma snapshot inmediato (ver [Mitigación interim](#mitigación-interim)).

---

## 1. Stack local-first hasta Sprint 5

### 1.1 Buckets / Object Storage

| Bucket | Hoy (Sprint 1–4) | Sprint 5 (target) |
| --- | --- | --- |
| `audit` | LocalStack S3, **versioning ON, Object Lock OFF** | S3 mx-central-1 + replicación us-east-1, **Object Lock COMPLIANCE 730 días** |
| `certificates` | LocalStack S3, **versioning ON, Object Lock OFF** | Idem audit (730 días) |
| `exports` | LocalStack S3, **mutable**, sin versioning | S3 + Object Lock COMPLIANCE 730 días |
| `uploads` | LocalStack S3, **mutable**, sin versioning | S3 con lifecycle (TTL 90 días); no requiere Object Lock |

> Implicación: **cualquier escritura es reversible/sobreescribible** hasta que se aplique Object Lock. Un actor con credenciales válidas puede borrar versions; LocalStack no aplica MFA Delete.

### 1.2 Audit log (Postgres)

- Persiste vía `AuditInterceptor` (NestJS) en tabla `audit_log` con `tenant_id`, `actor_id`, `action`, `resource_type`, `resource_id`, `metadata jsonb`, `created_at`.
- RLS por `tenant_id` activo.
- **Mutable**: un `DELETE` desde la consola admin de Postgres (o un actor con DBA) deja sin trace la fila. La BD es restorable desde backup, **no inmutable**.

### 1.3 Logs

- Backend NestJS: stdout → Docker container logs. `docker logs` rota por config default (sin firma, sin export off-host).
- LocalStack / Postgres: idem (stdout → docker logs).
- Frontend Next.js: stdout en dev; en producción todavía no hay sink (Sprint 5 → CloudWatch Logs con retención 90 días + KMS).

### 1.4 Mailpit

- Mailpit es **dev-only**: NO está en el path productivo. Cuando salgamos del sandbox SES (AWS-002) los correos van directo a SES y de ahí al destinatario; no hay copia en Mailpit fuera de dev. Su estado mutable no es un riesgo regulatorio.

---

## 2. Implicaciones de seguridad / cumplimiento

| Área | Riesgo |
| --- | --- |
| LFPDPPP / DPA / Aviso de Privacidad | El Aviso (LEG-001) menciona "registros de acceso conservados 24 meses". Hoy esa retención **no es enforceable** sin Object Lock. Si la doctora Lucía o un cliente solicita prueba forense de un acceso, sólo podemos ofrecer copia mutable. |
| Pentest Sprint 5 | Si el pentester ataca la BD y borra `audit_log`, perdemos trace. La hipótesis del informe será que la evidencia es no-repudiable; debemos calificar eso. |
| Continuidad / DR | Sin Object Lock + sin replicación cross-region, una pérdida regional = pérdida total. LocalStack además es ephemeral (volumen Docker se pierde si se hace `docker compose down -v`). |

---

## 3. Mitigación interim

### 3.1 Backups Postgres diarios

Mientras Sprint 5 no entregue RDS + backups automáticos, programar `pg_dump` local. Ejemplo de crontab (zona local):

```cron
# Cada día a las 02:00, dumpear la BD del stack local y archivar
# fuera del volumen de Docker. Output cifrado con gpg para minimizar fuga
# si la copia se filtra.
0 2 * * * cd /Users/<dev>/SaaS/segurasist-api && \
  docker compose exec -T postgres \
    pg_dump -U segurasist -Fc segurasist \
    | gpg --batch --yes --passphrase-file ~/.config/segurasist/dump.pwd -c \
    > ~/segurasist-backups/$(date +\%Y\%m\%d)-postgres.dump.gpg
# Retener últimos 14 días
30 2 * * * find ~/segurasist-backups -name "*.dump.gpg" -mtime +14 -delete
```

> Nota: para entornos multi-dev este script hay que ejecutarlo SÓLO en el
> Tech Lead / DevOps, no en máquinas de devs individuales (los datos seed son
> ficticios pero el proceso instituye la disciplina).

### 3.1.1 Operativa de backups (interim)

> Owner: Tech Lead. Vigente desde Sprint 1 hasta el provisioning de RDS en
> Sprint 5. Reemplaza al ejemplo crontab de [3.1](#31-backups-postgres-diarios)
> con un script versionado.

**Comando**:

```bash
cd segurasist-api
./scripts/backup.sh
```

**Qué hace**:

1. Verifica que el container `segurasist-postgres` esté `healthy`.
2. `pg_dump --format=custom --compress=9 --no-owner --no-privileges` contra el
   stack local.
3. Calcula `sha256sum` del dump.
4. Sube `<file>.dump` y `<file>.dump.sha256` a
   `s3://segurasist-dev-audit/backups/YYYY/MM/DD/segurasist-<TS>.dump`
   (LocalStack hoy, S3 mx-central-1 en Sprint 5).
5. Imprime metadata firmada (timestamp UTC, tamaño, sha256, S3 URI, restore
   command) y limpia el archivo temporal local (trap EXIT).

El sha256 funciona como **interim audit-trail firmado**: dado que hoy el
bucket no tiene Object Lock COMPLIANCE, la firma no es no-repudiable, pero sí
permite detectar tampering posterior si el dump se conserva offline.

**Frecuencia recomendada**: diaria, fuera de horario laboral.

macOS (`launchd`, `~/Library/LaunchAgents/com.segurasist.backup.plist`):

```xml
<!-- Cada día a las 02:15 local. Loguea a ~/Library/Logs/segurasist-backup.log -->
<key>Label</key><string>com.segurasist.backup</string>
<key>ProgramArguments</key>
<array>
  <string>/bin/bash</string>
  <string>-lc</string>
  <string>cd /Users/&lt;dev&gt;/SaaS/segurasist-api &amp;&amp; ./scripts/backup.sh</string>
</array>
<key>StartCalendarInterval</key><dict>
  <key>Hour</key><integer>2</integer>
  <key>Minute</key><integer>15</integer>
</dict>
<key>StandardOutPath</key><string>/Users/&lt;dev&gt;/Library/Logs/segurasist-backup.log</string>
<key>StandardErrorPath</key><string>/Users/&lt;dev&gt;/Library/Logs/segurasist-backup.log</string>
```

Linux (`/etc/cron.d/segurasist-backup`):

```cron
15 2 * * * <user> cd /opt/segurasist/segurasist-api && ./scripts/backup.sh \
  >> /var/log/segurasist-backup.log 2>&1
```

**Restore**:

```bash
# Desde S3 (con confirmación interactiva 'yes' antes de wipe)
./scripts/restore.sh s3://segurasist-dev-audit/backups/2026/04/26/segurasist-20260426T181310Z.dump

# Desde archivo local (requiere el .sha256 paralelo)
./scripts/restore.sh /tmp/segurasist-20260426T181310Z.dump
```

El script verifica el sha256 antes de tocar la BD y pide confirmación
explícita (`yes`) antes de `pg_restore --clean --if-exists`.

**Retención**: hoy NO se aplica retención automática (variable
`RETENTION_DAYS=14` reservada). Sprint 5 lo cierra con S3 Lifecycle real.
En el interim: rotación manual del bucket cada release o por incidente.

**Plan de cierre — Sprint 5 (ADR-012)**:

| Hoy (interim) | Sprint 5 (target) |
| --- | --- |
| Dump local + LocalStack S3 | RDS Postgres con automated daily backups |
| Versioning ON, Object Lock OFF | Object Lock COMPLIANCE (audit), Lifecycle (uploads) |
| Sin replicación | Cross-region replica mx-central-1 → us-east-1 |
| Retención manual | 35 días automáticos + snapshot manual pre-deploy |
| sha256 paralelo (interim integrity) | KMS-signed CloudTrail + RDS PITR |

Mientras tanto, el dump + sha256 + bucket versioned cubren la disciplina
operativa y dejan trazabilidad mínima auditable.

### 3.2 Snapshot inmediato ante hallazgos

**Disparador**: cualquier hallazgo de seguridad (gitleaks pre-commit en CI, alerta de gh advanced security, comportamiento anómalo en `npm run dev`, etc.).

Procedimiento:

1. Pausar tráfico al stack local (`docker compose stop`).
2. Snapshot Postgres: `docker compose exec postgres pg_dumpall -U segurasist > /tmp/segurasist-incident-$(date +%s).sql`.
3. Dump completo de logs Docker:
   ```bash
   for c in $(docker compose ps -q); do
     docker logs "$c" > "/tmp/segurasist-incident-$(date +%s)-$c.log" 2>&1
   done
   ```
4. Snapshot del bucket LocalStack:
   ```bash
   aws --endpoint-url=http://localhost:4566 s3 sync s3://segurasist-audit-local /tmp/incident-audit-$(date +%s)
   ```
5. Cifrar el directorio resultante con `gpg --symmetric` (passphrase guardada en 1Password Business — bloqueado por OPS-001).
6. Subir a almacenamiento offline (HD cifrado / S3 personal con cifrado SSE-KMS) y notificar a Tech Lead + Roy.

### 3.3 Hábitos de desarrollo

- Antes de `docker compose down -v`, exportar `audit_log` si hay datos relevantes.
- No ejecutar `localstack-bootstrap.sh` con `--clean` en branches que se hayan ramificado de un estado real.
- Code review obligatorio para cualquier cambio en `AuditInterceptor` o en migraciones de `audit_log`.

---

## 4. Plan de cierre (Sprint 5)

Bloqueos externos requeridos:

- AWS-001 (cuentas Organizations).
- AWS-003 (dominio + ACM).
- AWS-004 (servicios mx-central-1).
- LEG-001 (DPA firmado).

Entregables Sprint 5 que cierran este riesgo:

1. **S3 Object Lock COMPLIANCE** activado en buckets `audit`, `certificates`, `exports` con retención **730 días** (24 meses, alineado al Aviso de Privacidad).
2. **Replicación cross-region** mx-central-1 → us-east-1 para los mismos buckets (ADR-012 revisado).
3. **CloudTrail multi-account** archivado en bucket protegido por Object Lock COMPLIANCE 7 años (estándar regulatorio mexicano).
4. **CloudWatch Logs retention** 90 días en logs operativos, 365 días para auth/audit, cifrados con KMS por tenant.
5. **RDS Postgres** con backups automáticos 35 días + snapshot manual previo a deploy.
6. **Pentest externo** (proveedor TBD): primer informe con la postura ya endurecida — sólo entonces el `audit_log` cuenta como evidencia no-repudiable.

Una vez cerrado Sprint 5, este documento se archiva (mover a `docs/archive/INTERIM_RISKS-2026.md`) y se elimina la sección de "Riesgos operativos vigentes" de `PROGRESS.md`.

---

## Referencias

- `docs/PROGRESS.md` — sección "Riesgos operativos vigentes".
- `MVP_08_Seguridad_Cumplimiento_SegurAsist.docx` — política de retención original.
- ADR-012 (cross-region DR us-east-1).
- ADR-014 (región primaria mx-central-1).
