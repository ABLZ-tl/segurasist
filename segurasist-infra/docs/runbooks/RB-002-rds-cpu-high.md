# RB-002 — RDS CPU high

- **Severity**: P2 (P1 si CPU >95% sostenido + connection pool exhausted)
- **On-call SLA**: acknowledge ≤ 30 min (business hours), resolve ≤ 8 h
- **Owner**: DevOps on-call + Backend Senior
- **Triggered by**: CloudWatch alarm `segurasist-{env}-rds-cpu-high`
  (>80% en dev/staging, >75% en prod por 5 min sostenido)
- **Companion alarm**: `segurasist-{env}-rds-connections-high` (RB-002 also)

## Symptom

- API responses lentas (p95 latencia > 2s).
- Pino logs: `connection slot is reserved` / `pool exhaustion` /
  `timeout exceeded when trying to connect` desde Prisma.
- Performance Insights muestra wait events `LWLock:buffer_content` o
  `IO:DataFileRead` dominantes.

## Detection

| Source | Metric |
|---|---|
| CloudWatch | `AWS/RDS CPUUtilization` Avg > 80% (75% prod) |
| CloudWatch | `AWS/RDS DatabaseConnections` Max > 50 (~63% t4g.small) |
| Performance Insights | DBLoad > vCPU count |
| App logs | Prisma timeouts > 10/min |

## Triage (≤ 5 min)

1. Confirmar que CPU NO es spike cosmético (mantenimiento, vacuum):
   ```bash
   aws rds describe-events --source-identifier segurasist-{env}-rds-main \
     --duration 60
   ```
2. Mirar **slow query log** en Performance Insights → top 5 queries por
   total_time. Si una query domina → ir directo a Mitigation paso 3.

## Mitigation

1. **Identificar query culpable** (Performance Insights → Top SQL):
   - `pg_stat_activity`:
     ```sql
     SELECT pid, state, age(clock_timestamp(), query_start) AS dur, query
     FROM pg_stat_activity
     WHERE state != 'idle' AND age(clock_timestamp(), query_start) > '30s'::interval
     ORDER BY dur DESC LIMIT 20;
     ```
   - Si hay query rogue (>1 min runaway, típico N+1 en `insureds.list`):
     ```sql
     SELECT pg_terminate_backend(<pid>);
     ```
2. **Connection pool reset App Runner**: rolling restart fuerza re-pool
   (`aws apprunner start-deployment`).
3. **Vertical scale temporal** (last resort, requiere downtime ~5 min):
   - Cambiar `instance_class` en `envs/{env}/main.tf`
     (`db.t4g.small` → `db.t4g.medium`) → `terraform apply`.
   - Confirmar con Backend Lead antes (cost impact + commitment de
     post-incident downsize).
4. **Read-replica routing** (si exists): re-enrutar lecturas pesadas
   (`/v1/insureds`, `/v1/audit/verify-chain`) a replica vía Prisma
   `datasources.replica`.

## Root cause investigation

- Cross-check con deploy reciente: ¿un PR introdujo `findMany` sin
  `take/skip`? Run `pg_stat_statements` diff últimos 7 d.
- Index health: `SELECT schemaname, indexrelname, idx_scan FROM pg_stat_user_indexes WHERE idx_scan = 0`.
- Check H-26 (throttle global lowered) — si throttle desactivado y
  endpoint expensive (`audit/verify-chain` H-02) sin guard, atacante
  cualquiera puede tirar RDS.

## Postmortem checklist

- [ ] Query/PR culpable identificado con line-link.
- [ ] Tiempo a mitigation: ≤ 8h SLA cumplido?
- [ ] Action items: index missing? Need read-replica? Code fix?
- [ ] Prevention: ¿agregar tests `pg_stat_statements` baseline en CI?
