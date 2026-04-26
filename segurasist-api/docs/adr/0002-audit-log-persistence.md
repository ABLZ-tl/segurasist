# ADR-0002 — Persistencia de `audit_log` en BD vía writer dedicado

- Status: Aceptado
- Fecha: 2026-04-25
- Decisores: Backend Senior, Tech Lead
- Tickets: H2 (auditoría persistente — Sprint 1)

## Contexto

Hasta Sprint 0 el `AuditInterceptor` sólo emitía un evento estructurado a pino. La tabla `audit_log` (modelo `AuditLog` en `prisma/schema.prisma`) existía con todos los campos relevantes (`tenant_id`, `actor_id`, `action`, `resource_type`, `resource_id`, `ip`, `user_agent`, `payload_diff`, `trace_id`, `occurred_at`) pero ningún proceso del API escribía en ella.

Necesitamos persistir las mutaciones para:

1. **Cumplimiento** — ADR-013 obliga retener auditoría 24 meses con S3 Object Lock Compliance. CloudWatch + Subscription Filter → S3 sigue siendo el camino primario, pero la BD da consultas inmediatas para `/v1/audit/log`.
2. **Forense intra-tenant** — un `admin_mac` debe poder ver quién creó/modificó un asegurado.
3. **Defensa en profundidad** — si CloudWatch tira un evento, la BD lo retiene como segunda copia.

## Decisión

1. **PrismaClient dedicado al writer** (`AuditWriterService`), distinto del `PrismaService` request-scoped que usa el resto de la app:
   - Toma su URL de la env var `DATABASE_URL_AUDIT`.
   - Apunta a un rol `BYPASSRLS` (idealmente `segurasist_admin`). Justificación: las políticas RLS exigen `app.current_tenant`, pero algunas mutaciones cruzan tenants (p.ej. operaciones de superadmin); el writer NO debe ser bloqueado por RLS al insertar el evento — el evento describe el cruce, no causa la fuga.
   - Si `DATABASE_URL_AUDIT` no está presente, el writer degrada a **pino-only**: loguea con flag `audit:true` y NO inserta. Esto evita conflictos con M2 (rediseño paralelo del modelo de superadmin) y permite arrancar el bootstrap sin la var. Cuando M2 aterrice, marcaremos la var como obligatoria en `env.schema.ts`.

2. **Fire-and-forget** desde el `AuditInterceptor`:
   - El interceptor llama `void writer.record(event)` sin `await`.
   - El writer captura cualquier excepción internamente y la registra como `warn`. Nunca propaga al pipeline HTTP.
   - **Trade-off**: si la BD de audit está caída, perdemos el evento en BD pero NO tiramos el response 200 legítimo. CloudWatch (vía pino) sigue siendo el ledger duradero.

3. **Sólo mutaciones (POST/PUT/PATCH/DELETE)**. Los GET son ruido — el access log de CloudFront/ALB ya los conserva. Login/logout/reissue se mapean a sus acciones específicas (`login`, `logout`, `reissue`) por heurística de URL.

4. **Scrubbing recursivo** del `payloadDiff` antes de persistir:
   - Lista local de claves sensibles (sincronizada con redact de pino): `password`, `token`, `idToken`, `accessToken`, `refreshToken`, `cognitoSub`, `curp`, `rfc`, `authorization`, `cookie`, `otp`, `secret`, `apiKey`.
   - Reemplazo por `[REDACTED]`, profundidad máxima 8 niveles para evitar bombs.

## Consecuencias

- **Operativas**: en local con docker-compose podemos correr sin `DATABASE_URL_AUDIT` (modo log-only). En staging/prod debe estar definida; el playbook de deploy incluirá la creación del rol `segurasist_admin` y el secret en Secrets Manager.
- **Performance**: el `record(...)` es asíncrono y no bloquea. Cada inserción es una sola fila; volumen estimado ≤ 500/req-mutantes/día por tenant en MVP — lejos de saturar `db.t4g.small`.
- **Retención**: la limpieza física de la tabla NO es responsabilidad de este servicio. Sprint 5 implementa CloudWatch Events → Lambda que vuelca filas > 24m a S3 Object Lock y las elimina del Postgres. Mientras tanto, `audit_log` crece sin truncado.
- **Observabilidad**: cada evento sigue duplicándose a pino (con `audit:true`) — la operación detecta caída del writer mirando ratio CloudWatch / BD.

## Alternativas descartadas

- **Cliente Prisma compartido (request-scoped) con SET LOCAL**: requería que el operador tuviera permiso RLS para INSERTAR en `audit_log` de su mismo tenant. Rompe el caso superadmin cross-tenant.
- **Cola SQS intermedia (audit-events queue → Lambda → BD)**: agrega latencia operacional, infra extra y tooling de DLQ por un beneficio marginal en MVP. Lo dejamos para post-MVP si el writer in-process se vuelve cuello de botella.
- **`@nestjs/event-emitter` con handler async**: introduce un layer de eventos sólo para esta responsabilidad. Más simple llamar al servicio directo.

## Referencias

- `MVP_08_Seguridad_Cumplimiento_SegurAsist.txt` (§auditoría)
- ADR-0001 (decisión 13: S3 Object Lock retención 24m)
- `prisma/schema.prisma` modelo `AuditLog`
- `src/common/interceptors/audit.interceptor.ts`
- `src/modules/audit/audit-writer.service.ts`
