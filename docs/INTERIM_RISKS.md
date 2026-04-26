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
