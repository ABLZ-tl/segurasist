# ADR-0005 — Audit log: mirror inmutable a S3 con Object Lock COMPLIANCE

- Status: Aceptado
- Fecha: 2026-04-25
- Decisores: Tech Lead, DevOps + CISO
- Story relacionada: Sprint 2 — S2-07
- Documentos relacionados: ADR-0002 (audit log persistence), `docs/INTERIM_RISKS.md` §1.2

## Contexto

Después del Sprint 1 hardening final (hash chain SHA-256 en `audit_log`), la
cadena permite **detectar** tampering en BD vía `GET /v1/audit/verify-chain`,
pero NO lo **previene** ni recupera la evidencia. Postgres es restorable
desde backup pero mutable: un DBA, un atacante con creds válidas, o un
operador descuidado puede `DELETE` o `UPDATE row_hash` y dejar la cadena
"reparada" en apariencia (siempre que recompute prev_hash de las filas
posteriores con coherencia).

El compromiso del Sprint 1 era cerrar este gap en Sprint 5 con AWS S3 real
+ Object Lock COMPLIANCE. Sprint 2 acelera la mitigación trayendo el control
al stack local mientras el bloqueo AWS-001 (cuentas Organizations) sigue
pendiente.

## Decisión

**Mirror batched async del `audit_log` a un bucket S3 con Object Lock
COMPLIANCE 730 días** (LocalStack 3.x en dev, AWS S3 mx-central-1 en
Sprint 5). Tres componentes:

### 1. Bucket S3 inmutable

- LocalStack 3.x soporta Object Lock COMPLIANCE/GOVERNANCE en buckets
  creados con `--object-lock-enabled-for-bucket`. NO se puede convertir un
  bucket existente — por eso creamos `segurasist-dev-audit-v2` (separado
  del legacy `segurasist-dev-audit` que sigue usándose para pg_dumps).
- Default retention: COMPLIANCE 730 días (24 meses, alineado con LFPDPPP +
  Aviso de Privacidad).
- En modo COMPLIANCE NI EL ROOT account puede borrar/sobrescribir un
  objeto antes de que expire la retención. Es el control que defendemos.
- SSE-KMS con la key alias `segurasist-dev-audit` para que un actor con
  acceso al filesystem subyacente no pueda leer los NDJSON sin la key.

### 2. AuditS3MirrorService (worker batched)

- Cada **60s** (configurable vía `AUDIT_MIRROR_INTERVAL_MS`):
  1. SELECT FROM audit_log WHERE mirrored_to_s3=false LIMIT 1000 (partial
     index `audit_log_mirror_idx`).
  2. Agrupa por `(tenant_id, fecha UTC)`.
  3. PUT `audit/{tenantId}/{YYYY}/{MM}/{DD}/{batchId}.ndjson` con SSE-KMS.
  4. UPDATE audit_log SET mirrored_to_s3=true, mirrored_at=now() WHERE id IN (…).
- **Falla graceful**: si S3 está abajo, las filas siguen `mirrored_to_s3=false`
  y el siguiente tick reintenta. **Nunca pierde filas**.
- **No bloquea writes**: el `AuditWriterService` no espera al mirror;
  `mirrored_to_s3=false` es el default en INSERT.
- **Append-only en S3**: cada batch es un objeto distinto (`batchId` =
  timestamp ISO compacto). Nunca sobrescribimos un NDJSON existente.

### 3. verify-chain extendido

`GET /v1/audit/verify-chain?source=db|s3|both`:

- `db` (default): comportamiento original Sprint 1 (recompute en BD).
- `s3`: descarga NDJSONs del bucket inmutable, recompone cadena, verifica
  contra `prev_hash`/`row_hash` almacenados.
- `both`: cross-check fila a fila — tampering en BD que no haya tocado el
  mirror se detecta como `row_hash_mismatch` en `discrepancies`. Filas
  escritas en los últimos 60s y aún no mirroreadas se ignoran (no falso
  positivo por eventual consistency).

### 4. Formato NDJSON canónico

Una línea por fila con todos los campos relevantes para recompute:
`id, tenantId, actorId, action, resourceType, resourceId, ip, userAgent,
payloadDiff, traceId, occurredAt (ISO), prevHash, rowHash`. Permite que
`verifyChainFromMirror` reconstruya el SHA-256 de cada fila sin tocar BD.

## Alternativas rechazadas

| Alternativa | Por qué no |
| --- | --- |
| **AWS QLDB** (ledger DB managed) | Vendor lock-in, costo no marginal, overkill para MVP. Solo justificado si necesitamos Merkle proofs criptográficos accesibles a auditores externos — no es el caso. |
| **CloudTrail-only** | Solo captura llamadas a la API de AWS, no eventos de aplicación (mutaciones de insureds, certificates). Resolución insuficiente. |
| **DynamoDB Streams** | Vendor lock-in, requiere modelar el audit_log en DDB (vs Postgres + RLS que ya tenemos). Migración costosa para un beneficio marginal. |
| **Sync síncrono al mismo write** | Bloquea la respuesta HTTP mientras S3 PUT termina. Latencia inaceptable + acopla la disponibilidad del API a S3. |
| **Eventbridge → Lambda → S3** | Stack adicional para un control que cabe en un setInterval simple. Reservado para Sprint 5 si necesitamos fan-out a múltiples consumidores. |

## Consecuencias

### Positivas

- **Defensa en profundidad real**: tampering en BD ya no es invisible —
  cualquier `UPDATE row_hash` o `DELETE` queda detectable vía source=both.
- **Recuperación**: si el `audit_log` queda corrupto, podemos rehacerlo
  parsing el NDJSON (los row_hashes en S3 garantizan integridad de la
  reconstrucción).
- **No-repudiable** localmente: en LocalStack 3.x el Object Lock
  COMPLIANCE bloquea DELETE/PUT del bucket — incluso para el root.
- **Migración a Sprint 5 trivial**: cambiar `S3_BUCKET_AUDIT` y
  `AWS_ENDPOINT_URL` apunta el mismo código a AWS S3 real.

### Negativas / a vigilar

- **Eventual consistency 60s**: una fila escrita en t=0 puede no estar en
  S3 hasta t≈60s. `verify-chain?source=both` filtra filas no-mirroreadas
  para no falso-positivar, pero un atacante con conocimiento de la ventana
  podría tocar una fila en BD en los primeros segundos de su existencia.
  Mitigación parcial: el hash chain igual detecta tampering local en
  source=db. Sprint 5: bajar a 5s o usar Kinesis Firehose + S3 sink near
  real-time si el SLA lo requiere.
- **LocalStack ≠ AWS real legalmente**: el Object Lock de LocalStack es
  una emulación; un actor con acceso al docker host puede tocar
  `/var/lib/localstack/cache/segurasist_localstack` directo. Documentado
  en `INTERIM_RISKS.md` §1.2. Sprint 5 cierra con AWS S3 real + IAM
  policies que prohíben `s3:DeleteObjectVersion`.
- **Costo S3**: marginal (NDJSON comprimible, <1MB por tenant/día típico).
  Sprint 5: agregar S3 Intelligent-Tiering para archivar batches >90 días.
- **Doble PrismaClient**: el writer y el mirror service comparten
  `DATABASE_URL_AUDIT` pero abren conexiones separadas. Aceptable para
  MVP; consolidar cuando M2 (rediseño superadmin) consolide PrismaClients.

## Plan Sprint 5 (cierre completo)

1. **Provisioning AWS** del bucket `audit-v2` en mx-central-1 con la misma
   config (Object Lock COMPLIANCE 730d, SSE-KMS, versioning).
2. **Cross-region replication** mx-central-1 → us-east-1 (compliance con
   ADR-012).
3. **IAM bucket policy** que niega `s3:DeleteObjectVersion`,
   `s3:BypassGovernanceRetention`, `s3:PutBucketObjectLockConfiguration`
   a TODOS los principals incluyendo root (defensa contra credenciales
   comprometidas).
4. **CloudTrail data events** habilitados para el bucket — toda lectura
   queda auditada por separado.
5. **Alerting**: CloudWatch metric filter sobre logs del worker para
   alertar si `failedBatches > 0` consecutivos en >5 ticks.

## Referencias

- `prisma/migrations/20260426_audit_log_mirror_flag/migration.sql`
- `src/modules/audit/audit-s3-mirror.service.ts`
- `src/modules/audit/audit-chain-verifier.service.ts`
- `src/modules/audit/audit.controller.ts` (verify-chain con `?source=`)
- `scripts/localstack-bootstrap.sh` (bucket `*-audit-v2` con Object Lock)
- `test/integration/object-lock-immutability.spec.ts`
- `test/integration/audit-mirror-flow.spec.ts`
- `test/integration/verify-chain-cross-source.spec.ts`
- `test/unit/modules/audit/audit-s3-mirror.spec.ts`
- `test/unit/modules/audit/verify-chain-s3.spec.ts`
- `docs/INTERIM_RISKS.md` §1.2 (riesgo cerrado parcialmente).
