# SegurAsist — Plan de Respuesta a Incidentes (IRP)

> **Owner**: Tech Lead (incident commander por defecto) + DevOps
> **Última actualización**: 2026-04-26
> **Próxima revisión**: cierre de Sprint 5 (post-pentest inicial)
> **Documentos relacionados**: [`PROGRESS.md`](./PROGRESS.md) · [`INTERIM_RISKS.md`](./INTERIM_RISKS.md) · [`SUB_PROCESSORS.md`](./SUB_PROCESSORS.md) · [`OWASP_TOP_10_COVERAGE.md`](./OWASP_TOP_10_COVERAGE.md)

Este plan es operativo y testeable. Cada sección está pensada para ejecutarse durante un incidente sin tener que improvisar. El equipo del MVP es pequeño, por lo que algunos roles los acumula la misma persona — eso está marcado explícitamente.

## Tabla de contenidos

1. [Owner y matriz de escalación](#1-owner-y-matriz-de-escalación)
2. [Clasificación de severidad P0–P3](#2-clasificación-de-severidad-p0p3)
3. [Procedimiento operativo (runbook)](#3-procedimiento-operativo-runbook)
4. [Templates y anexos](#4-templates-y-anexos)
5. [Disaster Recovery — punteros](#5-disaster-recovery--punteros)
6. [Calendario de pruebas](#6-calendario-de-pruebas)
7. [Glosario](#7-glosario)

---

## 1. Owner y matriz de escalación

### 1.1 Roles

| Rol | Responsabilidad | Asignación MVP |
|---|---|---|
| Incident Commander (IC) | Decisiones, asigna tareas, declara severidad, autoriza notificación | Tech Lead |
| DevOps / SRE | Contención técnica (revoke tokens, rotación, restore, infra) | DevOps Lead |
| Security Liaison / CISO | Triaje de severidad, control de evidencia, coordina pentest follow-up | Tech Lead (acumula CISO en MVP) |
| Legal / DPO | Notificación a INAI, coordinación con clientes (DPA), revisión legal de comunicados | Externo on-retainer + PO como interlocutor |
| Comms | Redacción y envío de comunicados, status page, Slack | PO + Customer Success |
| Scribe | Bitácora cronológica del incidente (timeline para post-mortem) | Cualquier ingeniero presente que no sea IC ni DevOps |

> En MVP el Tech Lead acumula IC + Security Liaison. Cuando la dotación lo permita (post Sprint 5) se separa la función Security en un rol dedicado.

### 1.2 Matriz de escalación

| Severidad | Quién dispara | A quién escala (T+0) | A quién escala (T+1h sin contención) |
|---|---|---|---|
| P0 | Quien lo detecte (operador, alerta, cliente) | IC + DevOps + DPO + PO | Sponsor (Roy) + Legal externo |
| P1 | Quien lo detecte | IC + DevOps | DPO si toca PII |
| P2 | IC tras triaje | DevOps en horario hábil | n/a |
| P3 | Backlog en Linear/GitHub Issues | n/a | n/a |

### 1.3 Línea de contacto fallback

- Slack `#segurasist-incidents` (cuando OPS-004 desbloquee). Hasta entonces: WhatsApp grupal `SegurAsist-Ops`.
- PagerDuty rotación on-call (cuando OPS-002 desbloquee) — número público publicado en status page.
- Email `incidents@segurasist.app` (alias a IC + DevOps) — habilitado en Sprint 5 cuando salga SES de sandbox (AWS-002).
- DPO público: `dpo@segurasist.app` (LEG-001).

> **Hoy (Sprint 1–4)**: la línea oficial es WhatsApp grupal hasta que OPS-002/OPS-004 desbloqueen. Documentar el uso en el post-mortem si se aplica.

---

## 2. Clasificación de severidad P0–P3

| Severidad | Definición | Ejemplo | SLA detección | SLA respuesta inicial | SLA notificación cliente |
|---|---|---|---|---|---|
| **P0** | Brecha confirmada de datos personales o de salud (PHI/PII) / breach LFPDPPP / sistema productivo down >30 min con impacto a clientes / RLS bypass confirmado | Exfiltración detectada en logs de S3, ransomware sobre RDS, JWT de un tenant lee datos de otro tenant | inmediata (alarma o reporte) | <15 min | <72 h (LFPDPPP MX) / <72 h (GDPR si aplica) |
| **P1** | Vulnerabilidad crítica explotable sin mitigación / sistema degradado con error rate >5% / auth bypass parcial | RCE en dependencia transitiva, bypass parcial del rate limit que no compromete tenant isolation, latencia 10x sostenida | <1 h | <2 h | <24 h |
| **P2** | Vulnerabilidad no crítica / falla parcial sin pérdida de datos / hallazgo en pentest medium | XSS reflejado en endpoint admin protegido, header `Cache-Control` faltante, latencia 2x sostenida | <4 h | <1 día hábil | <1 semana |
| **P3** | Hallazgo de hardening recomendado / log verbosity / observación de pentest low | Falta header `Permissions-Policy`, suggestion en code review de seguridad | <1 semana | <1 sprint | n/a (cliente no afectado) |

### 2.1 Reglas de auto-escalación

- Cualquier incidente que toque la tabla `audit_log`, `users`, `insureds`, `certificates` o cualquier bucket en `audit/certificates/exports` arranca **mínimo P1**, hasta que IC determine alcance real.
- Cualquier sospecha de exfiltración cross-tenant (incluyendo logs de error con `tenant_id` ajeno al actor) arranca **P0**.
- Cualquier alerta de GuardDuty `Backdoor` / `CryptoCurrency` / `UnauthorizedAccess` (post Sprint 5) arranca **P0** automáticamente vía PagerDuty.

---

## 3. Procedimiento operativo (runbook)

### 3.1 Vista global (timeline)

```
T+0       Detección y triaje    →  Asignar tracking ID, severidad
T+15min   Contención P0         →  Aislar componente, revoke tokens
T+2h      Contención P1         →  Patch hotfix, feature flag
T+0..n    Recolección evidencia →  Snapshots, hash chain, custody
T+...     Erradicación          →  Parche definitivo, rotación
T+...     Recuperación          →  Restore + smoke + monitoreo 72h
T+24..72h Notificación          →  Cliente, INAI, equipo
T+5d      Post-mortem           →  Blameless, action items
```

### 3.2 a) Detección y triaje (T+0)

- [ ] Asignar **Tracking ID**: `INC-YYYYMMDD-NN` (ej. `INC-20260426-01`).
- [ ] Crear canal de incidente: Slack `#inc-INC-20260426-01` (o thread en `#segurasist-incidents`). Mientras OPS-004 esté pendiente: grupo de WhatsApp dedicado.
- [ ] IC declara severidad inicial conforme a §2 (puede recategorizarse).
- [ ] Scribe abre bitácora en Notion / `docs/incidents/INC-YYYYMMDD-NN.md` con timestamp T+0 y fuente de detección.
- [ ] Confirmar fuente: alarma de monitoring (UptimeRobot/CloudWatch), reporte de usuario, hallazgo manual, alerta GitHub Advanced Security, mensaje de cliente, etc.

### 3.3 b) Contención

#### Runbooks por categoría

##### Auth bypass / token comprometido (T+15min P0)

- [ ] `POST /v1/auth/revoke` para el refresh token sospechoso (si aplica) o invalidar el `cognito_sub` afectado.
- [ ] Cognito → User Pool → Users → Disable user (admin pool y/o insured pool según corresponda).
- [ ] Forzar `GlobalSignOut` para el usuario en Cognito (`AdminUserGlobalSignOut`).
- [ ] Si el bypass podría afectar otros usuarios: rotar la firma JWKS (Cognito rota Kid automáticamente al recrear el pool, en MVP cognito-local requiere reinicio del contenedor).
- [ ] Subir la guard correspondiente: aumentar throttle del endpoint comprometido a 1/min, deploy hotfix.

##### Data leak (T+15min P0)

- [ ] Cortar tráfico de salida del componente: bloquear egress en SG (post Sprint 5) o `docker compose stop` del servicio sospechoso (pre Sprint 5).
- [ ] Si el leak es vía endpoint público: feature-flag off (`FF_<endpoint>=false`) o deploy de versión anterior (`git revert` + redeploy).
- [ ] Ejecutar `verify-chain` del audit log (endpoint planeado Sprint 5; pre-S5 hacer query manual `SELECT count(*) FROM audit_log WHERE created_at > '<inicio_ventana>'` para detectar gaps).
- [ ] Identificar registros afectados con query parametrizada por tenant (NUNCA `SELECT *` en consola — siempre con `WHERE tenant_id = '<id>'`).

##### Cross-tenant leak / RLS bypass (T+15min P0)

- [ ] Confirmar con `psql` como rol `segurasist_app` (NOBYPASSRLS) que el query del actor sospechoso devuelve datos ajenos.
- [ ] Si se confirma bypass: deploy inmediato del último build verde verificado y rotar credenciales DB (rotar contraseña de `segurasist_app` y reiniciar API).
- [ ] Suspender ingestion de batches del tenant afectado (poner `tenants.status = 'frozen'`).

##### DoS / saturación (T+1h P1)

- [ ] Confirmar firma de tráfico anómalo en CloudWatch / nginx-style logs.
- [ ] Pre Sprint 5: bajar el rate limit global de 60/min a 20/min via env `THROTTLE_MAX=20` y reinicio rolling.
- [ ] Post Sprint 5: activar regla AWS WAF `RateBasedRule-Emergency` (5000 req/5min/IP) y bloquear ASN ofensores.
- [ ] Habilitar shield-advanced metrics si `shield-advanced` está suscrito.

##### Vulnerabilidad en dependencia (P0/P1 según CVSS)

- [ ] `npm audit --omit=dev` y `pnpm audit` para mapear paquetes afectados.
- [ ] Si el patch existe: bump y redeploy.
- [ ] Si no hay patch: aplicar mitigación (override en `package.json` resolutions, feature flag para deshabilitar la ruta, WAF rule custom).
- [ ] Marcar el ADR de seguridad si la mitigación queda permanente.

##### Ransomware / actor con privilegios DB

- [ ] **Aislar** la cuenta AWS afectada: SCP de emergencia que niega `s3:DeleteObject*`, `rds:Delete*`, `kms:ScheduleKeyDeletion` (pre-firmada en `segurasist-infra/global/organization/scps/emergency.json` post Sprint 5).
- [ ] Pre Sprint 5: en stack local, `docker compose stop` y respaldar volúmenes con `docker run --rm -v segurasist-postgres:/data -v $PWD:/backup alpine tar czf /backup/incident-postgres.tgz /data`.
- [ ] Snapshot RDS manual (post Sprint 5) — los snapshots automáticos pueden estar comprometidos si el actor ya escribió en BD.
- [ ] Restore desde Object Lock-protected backup (Sprint 5+).

### 3.4 c) Recolección de evidencia (en paralelo a contención)

> **Cadena de custodia**: cada artefacto se documenta como fila en la tabla §3.4.1 con timestamp, sha256, recolector, ubicación de almacenamiento.

#### Acciones

- [ ] Snapshot DB: `./scripts/backup.sh` (cuando exista; ver `segurasist-api/scripts/`). Pre-creación, ejecutar `docker compose exec postgres pg_dumpall -U segurasist > /tmp/INC-<id>-postgres.sql`.
- [ ] Copia de logs:
  - CloudWatch (post Sprint 5): `aws logs create-export-task --log-group-name /aws/apprunner/segurasist-api --from <ts> --to <ts> --destination s3://segurasist-incident-evidence-<accountId>`.
  - Pre Sprint 5: `for c in $(docker compose ps -q); do docker logs "$c" > "/tmp/INC-<id>-$c.log" 2>&1; done`.
- [ ] Hash chain de `audit_log`: ejecutar el endpoint `verify-chain` (Sprint 5) o exportar `SELECT id, tenant_id, actor_id, action, created_at, sha256(row_to_json(audit_log)::text) FROM audit_log WHERE created_at BETWEEN '<inicio>' AND '<fin>' ORDER BY created_at` y archivar.
- [ ] Trazas distribuidas (post Sprint 4 con APM): exportar window relevante.
- [ ] Snapshot de buckets afectados: `aws --endpoint-url <prod-or-localstack> s3 sync s3://<bucket> /tmp/INC-<id>-<bucket>`.
- [ ] Cifrar todo el directorio con `gpg --symmetric --cipher-algo AES256` y subir a:
  - Pre Sprint 5: HD cifrado físico en posesión del Tech Lead + copia en cuenta personal con SSE-KMS.
  - Post Sprint 5: `s3://segurasist-incident-evidence-<accountId>/<INC-id>/` (Object Lock COMPLIANCE 7 años).

#### 3.4.1 Tabla de cadena de custodia (template)

| Tracking ID | Artefacto | Ubicación origen | sha256 | Timestamp recolección | Recolector | Ubicación archivo |
|---|---|---|---|---|---|---|
| INC-YYYYMMDD-NN | postgres-dump.sql.gpg | docker exec | `<hash>` | 2026-MM-DDTHH:MM:SSZ | `<persona>` | `<ruta o s3 uri>` |
| INC-YYYYMMDD-NN | api-stdout.log.gpg | `docker logs api` | `<hash>` | 2026-MM-DDTHH:MM:SSZ | `<persona>` | `<ruta o s3 uri>` |
| INC-YYYYMMDD-NN | audit-chain.csv.gpg | `audit_log` query | `<hash>` | 2026-MM-DDTHH:MM:SSZ | `<persona>` | `<ruta o s3 uri>` |

> **Importante**: cualquier acción del propio IC sobre el sistema (revoke, restart, etc.) tiene que quedar en la bitácora ANTES de ejecutarse, con timestamp. La bitácora misma forma parte de la evidencia.

### 3.5 d) Erradicación

- [ ] Aplicar parche definitivo (PR con tag `[INC-<id>] hotfix`).
- [ ] Rotar credenciales y secretos potencialmente expuestos. Lista mínima de rotación tras P0:
  - JWKS Cognito (rota al recrear el pool — coordinar con MAC si SAML está activo).
  - Cognito User Pool app client secrets.
  - Postgres `segurasist_app` y `segurasist_admin` passwords (Secrets Manager rotation lambda post Sprint 5).
  - KMS CMK: NO se rotan vía recreación; rotación automática anual ya activa. Si una CMK se cree comprometida → schedule key deletion 30 días + reencrypt en CMK nueva.
  - Tokens de servicio: GitHub Actions OIDC role trust policy (revisar conditions), 1Password Service Accounts, PagerDuty API tokens, UptimeRobot API key.
  - Anthropic API key (Sprint 4+) — rotar desde console.
  - Webhooks externos.
- [ ] Bump de dependencias afectadas: `npm update <pkg>` + lockfile commit.
- [ ] Recrear recursos comprometidos (containers, IAM roles, security groups) — no parchear "in place" si hay sospecha de persistencia.
- [ ] Confirmar erradicación con re-test del vector original.

### 3.6 e) Recuperación

- [ ] Restore desde backup verificado: documentar checksum del backup elegido y validar en staging antes de prod.
- [ ] Smoke tests: ejecutar el subset crítico de e2e (`npm run test:e2e -- --testPathPattern='auth|rbac|cross-tenant'`).
- [ ] Reactivar tráfico gradualmente (canary 10% → 50% → 100% post Sprint 5; pre Sprint 5 reactivación binaria).
- [ ] **Monitoreo aumentado 72 h**: alarmas con thresholds más estrictos, on-call extendido, log review diaria por DevOps.
- [ ] Cerrar contención (re-habilitar usuarios bloqueados que NO eran el actor, levantar feature flags).

### 3.7 f) Notificación

#### 3.7.1 Cliente afectado

- SLA por severidad:
  - P0 con datos personales: <72 h desde detección confirmada (LFPDPPP Art. 16 Bis y reglamento). Si aplica GDPR (no es el caso MVP, pero queda preparado): <72 h desde "becoming aware".
  - P0 sin datos personales: <24 h.
  - P1 con datos personales: <24 h.
  - P1 sin datos personales: <72 h.
  - P2: <1 semana.
  - P3: n/a.
- Templates en §4.
- Canal: email firmado con DKIM al contacto contractual (Lucía + DPO MAC), copia a `dpo@segurasist.app` y al ticket interno.

#### 3.7.2 Reguladores aplicables

- **INAI** (Instituto Nacional de Transparencia, Acceso a la Información y Protección de Datos Personales): notificación de vulneración LFPDPPP cuando hay afectación a derechos del titular. Plazo recomendado: tan pronto como se confirme la brecha. Template en §4.4.
- **CONDUSEF** si hay afectación a productos financieros (no aplica MVP — SegurAsist no es producto financiero, es admin de membresías). Quedar atentos a si esto cambia en roadmap.
- **ARCO requests**: si el incidente bloquea el ejercicio de derechos ARCO, reportar al titular afectado y al INAI dentro del plazo del Art. 32.

#### 3.7.3 Equipo interno

- Slack `#segurasist-incidents` (post OPS-004): ping inicial al detectar, cada update relevante, confirmación al cierre.
- Pre OPS-004: WhatsApp grupal + email a sponsor (Roy) en P0/P1.

### 3.8 g) Post-mortem (T+5 días hábiles)

- [ ] Calendarizar sesión <90 min con IC, DevOps, PO, ingenieros involucrados.
- [ ] Reglas blameless: el objetivo es entender el sistema, no responsabilizar personas.
- [ ] Usar template §4.5.
- [ ] Distribuir el documento finalizado a Roy + sponsor + DPO MAC en P0/P1.
- [ ] Action items con owner y deadline. Si algún action item es Sprint 5+, anotar en `INTERIM_RISKS.md` o `PROGRESS.md`.

---

## 4. Templates y anexos

### 4.1 Email a cliente — P0 (brecha confirmada de datos personales)

> Asunto: `[Acción requerida] Aviso de vulneración de seguridad — SegurAsist · INC-YYYYMMDD-NN`

```
Estimado equipo de Hospitales MAC:

Por medio de la presente, en cumplimiento del Artículo 20 del Reglamento de la
LFPDPPP y de nuestro contrato de Tratamiento de Datos Personales, comunicamos
formalmente que el día <fecha y hora local de detección> SegurAsist confirmó
una vulneración de seguridad clasificada como severidad P0.

Naturaleza del incidente:
<descripción concreta y honesta — sin tecnicismos innecesarios — del vector
de ataque o causa raíz>.

Datos personales involucrados:
<lista exhaustiva: nombre, CURP, RFC, fecha de nacimiento, contacto,
información de salud, etc., delimitando el alcance numérico aproximado>.

Acciones tomadas por SegurAsist:
1. Contención inmediata: <medidas técnicas aplicadas — revocación, rotación,
   bloqueo, despliegue de parche>.
2. Recolección de evidencia bajo cadena de custodia documentada.
3. Erradicación del vector y verificación.
4. Restauración de servicio.
5. Notificación a INAI dentro del plazo aplicable.

Acciones recomendadas para Hospitales MAC:
- <p.ej. notificación a los titulares afectados conforme al Aviso de Privacidad>.
- <p.ej. revisión interna de cuentas con privilegios elevados>.
- <p.ej. monitoreo de uso anómalo en los próximos 30 días>.

Investigación en curso:
Compartiremos el reporte post-mortem completo en un plazo máximo de 10 días
hábiles, con análisis de causa raíz, medidas correctivas y plan de prevención.

Para coordinación inmediata, contactar al Data Protection Officer de
SegurAsist en dpo@segurasist.app o al Tech Lead <nombre> al <teléfono>.

Atentamente,
<nombre del firmante>
<cargo>
SegurAsist · Innovación Segura
```

### 4.2 Email a cliente — P1 (vulnerabilidad parcheada sin breach)

> Asunto: `[Informativo] Aplicación de parche de seguridad — SegurAsist · INC-YYYYMMDD-NN`

```
Estimado equipo de Hospitales MAC:

Como parte de nuestro proceso continuo de monitoreo y endurecimiento, el día
<fecha> identificamos y parchamos una vulnerabilidad de severidad P1 en la
plataforma SegurAsist.

Resumen:
- Naturaleza: <descripción no operativa>.
- Datos personales afectados: ninguno. Hemos confirmado mediante revisión de
  logs y evidencia inmutable que no hubo acceso no autorizado a información
  de asegurados ni a datos de Hospitales MAC.
- Acción tomada: parche aplicado el <fecha y hora>, validado por nuestro
  proceso de pruebas automatizadas (650+ tests) y revisión manual.

No se requiere acción de Hospitales MAC. La plataforma operó con normalidad
durante el incidente.

Mantendremos monitoreo aumentado por 72 horas y publicaremos un informe
ejecutivo en nuestra próxima revisión mensual de servicio.

Cualquier consulta a dpo@segurasist.app.

Atentamente,
<firmante>
SegurAsist · Innovación Segura
```

### 4.3 Status page (cuando OPS-003 desbloquee — `status.segurasist.app`)

```
[Investigando] <fecha y hora UTC>
Estamos investigando un incidente que afecta a <componente>. Algunos usuarios
pueden experimentar <síntoma>. Próxima actualización en 30 minutos.

[Identificado] <fecha y hora UTC>
Identificamos la causa: <descripción no operativa>. Estamos aplicando la
mitigación.

[Monitoreando] <fecha y hora UTC>
Mitigación aplicada. Estamos monitoreando para confirmar el restablecimiento.

[Resuelto] <fecha y hora UTC>
Servicio restablecido. El reporte post-mortem se publicará en los próximos
5 días hábiles.
```

### 4.4 Reporte a INAI — Aviso de Vulneración (LFPDPPP Art. 20 Reglamento)

> Formato: oficio en hoja membretada SegurAsist + envío por mecanismo INAI vigente.

```
Asunto: Aviso de Vulneración de Seguridad — Tratamiento de Datos Personales

A: Instituto Nacional de Transparencia, Acceso a la Información y
   Protección de Datos Personales (INAI)
De: <razón social SegurAsist + RFC>, en su carácter de Encargado del
   tratamiento, en relación con el Responsable Hospitales MAC.

1. Identificación del responsable y encargado:
   - Responsable: Hospitales MAC <RFC + domicilio fiscal>.
   - Encargado: SegurAsist <RFC + domicilio fiscal>.
   - DPO encargado: <nombre> · dpo@segurasist.app · <teléfono>.

2. Fecha y hora aproximada de la vulneración:
   <ts ISO 8601 con zona horaria>.

3. Fecha y hora de detección:
   <ts ISO 8601>. Diferencia detección — ocurrencia: <horas>.

4. Naturaleza de la vulneración:
   ☐ Pérdida o destrucción no autorizada
   ☐ Robo, extravío o copia no autorizada
   ☐ Uso, acceso o tratamiento no autorizado
   ☐ Daño, alteración o modificación no autorizada
   <marcar las que apliquen y describir>.

5. Datos personales comprometidos:
   <listado exhaustivo + categorías + volumen estimado>.

6. Recomendaciones al titular:
   <medidas que el titular debe tomar para proteger sus derechos>.

7. Acciones correctivas tomadas:
   <medidas técnicas y organizativas — referenciar el runbook seguido>.

8. Medios para obtener mayor información:
   dpo@segurasist.app · <teléfono DPO>.

Anexos:
- A. Cronología del incidente (timeline post-mortem).
- B. Evidencia de notificación al Responsable (Hospitales MAC).
- C. Evidencia de notificación a titulares afectados.
```

### 4.5 Post-mortem template

```markdown
# INC-YYYYMMDD-NN — Post-mortem

> Estado: Draft / In review / Final
> IC: <nombre>
> Severidad final: P<x>
> Fecha incidente: YYYY-MM-DD
> Fecha post-mortem: YYYY-MM-DD

## Resumen ejecutivo (≤5 líneas)

<qué pasó, impacto, cuánto tardó, está cerrado>

## Timeline (UTC)

| Hora | Evento | Actor |
|---|---|---|
| HH:MM | Alerta UptimeRobot disparada | sistema |
| HH:MM | IC asume incidente, declara P0 | <persona> |
| HH:MM | Contención aplicada | <persona> |
| ... | ... | ... |
| HH:MM | Servicio restablecido | <persona> |

## Impacto

- Usuarios afectados: <número>
- Tenants afectados: <lista>
- Datos comprometidos: <descripción>
- Tiempo de degradación / downtime: <minutos>
- Costo estimado (si aplica): <USD>

## Causa raíz (5 whys)

1. ¿Por qué <síntoma observado>? <respuesta>
2. ¿Por qué <respuesta 1>? <respuesta>
3. ¿Por qué <respuesta 2>? <respuesta>
4. ¿Por qué <respuesta 3>? <respuesta>
5. ¿Por qué <respuesta 4>? <respuesta — causa raíz real>

## Lo que funcionó

- <ej. la alarma de UptimeRobot disparó en <X> segundos>
- <ej. el rate limit contuvo el blast radius>
- <ej. el runbook X.Y se siguió sin desviaciones>

## Lo que no funcionó

- <ej. tardamos 12 minutos en confirmar la severidad porque la query
  manual de audit_log fue lenta>
- <ej. el contacto del DPO MAC no estaba en el grupo de WhatsApp>

## Action items

| ID | Acción | Owner | Deadline | Estado |
|---|---|---|---|---|
| AI-1 | <descripción concreta y verificable> | <persona> | YYYY-MM-DD | Open |
| AI-2 | <...> | <persona> | YYYY-MM-DD | Open |

## Evidencia

- Bitácora en `docs/incidents/INC-YYYYMMDD-NN.md`
- Evidencia cifrada en <ubicación>
- Sha256 de artefactos en cadena de custodia (§3.4.1)
```

---

## 5. Disaster Recovery — punteros

Este plan **no duplica** el plan de DR. Aquí los punteros:

| Tema | Documento de referencia |
|---|---|
| Cross-region DR strategy (mx-central-1 → us-east-1) | `segurasist-infra/docs/adr/012-cross-region-dr-us-east-1.md` |
| Región primaria (rationale del cambio a México) | `segurasist-infra/docs/adr/014-region-primaria-mx-central-1.md` |
| RTO/RPO documentados | `MVP_06_DevOps_IaC_SegurAsist.docx` §6 |
| Backups y restore (scripts pre-Sprint 5) | `segurasist-api/scripts/backup.sh` y `restore.sh` (referenciar — pueden no existir aún; el riesgo interim está cubierto en `INTERIM_RISKS.md` §3) |
| Política de retención de evidencia | `INTERIM_RISKS.md` §1 + `MVP_08_Seguridad_Cumplimiento_SegurAsist.docx` §3.11 |
| Object Lock COMPLIANCE plan (Sprint 5) | `INTERIM_RISKS.md` §4 |
| Sub-procesadores y sus DPAs | [`SUB_PROCESSORS.md`](./SUB_PROCESSORS.md) |
| Cobertura controles OWASP Top 10 | [`OWASP_TOP_10_COVERAGE.md`](./OWASP_TOP_10_COVERAGE.md) |

> **Pre Sprint 5**: el RTO/RPO efectivo está limitado por la mitigación interim documentada en `INTERIM_RISKS.md` §3 (snapshots `pg_dump` diarios cifrados, snapshot inmediato ante hallazgo). Comunicar este caveat a clientes en cualquier compromiso de SLA antes del Go-Live.

---

## 6. Calendario de pruebas

| Drill | Frecuencia (pre Sprint 5) | Frecuencia (post Sprint 5) | Owner | Evidencia esperada |
|---|---|---|---|---|
| Tabletop P0 (equipo recorre runbook con escenario simulado, sin acción real) | trimestral | trimestral | IC | Acta firmada + lista de gaps detectados → action items |
| Backup restore drill (restaurar `pg_dump` cifrado en entorno aislado y validar) | mensual | semestral | DevOps | Hash del dump original = hash del restaurado, queries de smoke pasan |
| DR failover drill (failover mx-central-1 → us-east-1, RTO/RPO medidos) | n/a (no hay infra real) | anual | DevOps | Reporte con tiempos reales vs RTO/RPO comprometidos |
| Pen test externo | n/a | anual (Sprint 5 inicial, recurrente) | CISO + proveedor TBD | Reporte con findings clasificados; remediación tracked |
| Phishing simulation (interno) | n/a | semestral post Go-Live | Comms + Security | Tasa de click + reporte |
| Rotation drill (rotar JWKS, KMS CMK, secrets manager) | n/a | semestral | DevOps | Logs de rotación + smoke tests verdes |
| Notification drill (envío del template §4.1 al equipo de Hospitales MAC en simulacro coordinado) | anual coordinado con MAC | anual | IC + PO | Confirmación de recepción + cronómetro contra SLA |

> **Tabletop trimestral pre Sprint 5**: usar escenarios extraídos de `INTERIM_RISKS.md` (ej. `docker compose down -v` accidental que borra `audit_log`, fuga de credencial GitHub Actions, RLS bypass por refactor).

---

## 7. Glosario

| Término | Definición |
|---|---|
| **IC** | Incident Commander — persona que toma decisiones durante el incidente. Tech Lead por defecto. |
| **DPO** | Data Protection Officer — Encargado de Datos Personales designado conforme a LFPDPPP (LEG-001). |
| **DPA** | Data Processing Agreement — contrato entre Responsable y Encargado del tratamiento. |
| **PHI** | Protected Health Information — información de salud sujeta a regulación específica (LFPDPPP la considera dato sensible). |
| **PII** | Personally Identifiable Information — datos personales identificables. |
| **RLS** | Row-Level Security (PostgreSQL) — aislamiento por `tenant_id`. |
| **RTO/RPO** | Recovery Time Objective / Recovery Point Objective. |
| **CMK** | Customer Master Key (AWS KMS). |
| **SLA** | Service Level Agreement — compromiso temporal de respuesta o disponibilidad. |
| **Tracking ID** | Identificador único del incidente formato `INC-YYYYMMDD-NN`. |
| **Cadena de custodia** | Registro auditable de cada artefacto de evidencia (origen, hash, recolector, almacenamiento). |
| **LFPDPPP** | Ley Federal de Protección de Datos Personales en Posesión de los Particulares (México). |
| **INAI** | Instituto Nacional de Transparencia, Acceso a la Información y Protección de Datos Personales. |
| **ARCO** | Acceso, Rectificación, Cancelación, Oposición — derechos del titular bajo LFPDPPP. |
| **Blameless** | Cultura de post-mortem orientada al aprendizaje del sistema, no a responsabilizar individuos. |
