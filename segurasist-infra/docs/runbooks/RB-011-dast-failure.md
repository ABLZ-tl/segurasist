# RB-011 — DAST (OWASP ZAP) failure en CI

- Severity: P2 (bloquea merge a `main`, no impacta producción)
- On-call SLA: acknowledge ≤ 2 h (business hours), resolve ≤ 24 h
- Owner: AppSec / DevOps on-call
- Story origen: S2-08

> Nota numeración: el plan original llamaba este runbook `RB-002-dast-failure`,
> pero `RB-002` ya estaba ocupado por `RB-002-rds-connection-saturation.md`.
> Se renumera a `RB-011` (siguiente disponible).

## Symptom

> Job `api-dast` o `web-dast` en GitHub Actions falla con mensaje:
>
>     ZAP found N HIGH risk issues — failing the workflow run
>
> El PR queda bloqueado: el check requerido `ci-success` no puede cerrar verde
> porque sus `needs.api-dast` / `needs.web-dast` están en `failure`.

## Detection

- GitHub Actions check rojo en el PR (job: `api-dast` o `web-dast`).
- Comentario automático del action `zaproxy/action-baseline` en el PR (si
  `allow_issue_writing: true`; actualmente está en `false`, así que el detalle
  vive sólo en el log + artifact).
- Artifact `zap-report-{api|web}-<sha>.html` adjunto al run.

## Diagnosis

1. Descargar el artifact HTML del run:
   ```bash
   gh run download <RUN_ID> -n zap-report-api-<sha> -D /tmp/zap
   open /tmp/zap/report.html
   ```
2. Identificar todos los findings con `Risk: High`. Para cada uno:
   - Capturar `Alert ID` (e.g., `40018`), `URL`, `Parameter`, `Evidence`.
   - Cruzar contra la matriz de excepciones en `.zap/rules.tsv`.
3. Clasificar cada finding como **REAL** o **FALSO POSITIVO**:
   - REAL: el payload de ZAP efectivamente desencadena comportamiento
     vulnerable (XSS reflejado en respuesta, error SQL leakeado, header
     faltante en respuesta de prod, cookie sin Secure en NODE_ENV=production-like).
   - FALSO POSITIVO: el finding aparece pero el control sí está implementado
     en otra capa (ejemplo: ZAP marca CSRF ausente en endpoint con SameSite=Strict
     + Origin allowlist; o CSP missing en endpoint que devuelve `application/json`
     con `X-Content-Type-Options: nosniff`).
4. Reproducir local con `./scripts/run-zap-baseline.sh api` para iterar más rápido.

## Recovery

### Camino A — finding REAL

1. Crear branch `fix/dast-<alert-id>-<short>` desde el PR afectado.
2. Implementar el fix de código:
   - **XSS reflejado** (40012/40014/...): escapar output, validar input con
     Zod, usar `helmet`/`@fastify/helmet` (ya activo en `main.ts`).
   - **SQL injection** (40018-40024): confirmar uso exclusivo de Prisma con
     parámetros (no `$queryRawUnsafe` con interpolación).
   - **Cookie sin Secure** (10001): forzar `Secure: true` cuando
     `NODE_ENV !== 'development'` en `set-cookie`.
   - **Cookie sin SameSite** (10054): `SameSite=Strict` (auditoría M6/L3).
   - **Permissions-Policy missing** (10063): agregar header en `helmet`
     options.
3. Volver a correr `./scripts/run-zap-baseline.sh api` local; verificar que
   el finding ya no aparece en el HTML.
4. Push, esperar a que CI pase, mergear.

### Camino B — finding FALSO POSITIVO

1. Editar `.zap/rules.tsv`: agregar línea
   ```
   <ruleId>\tIGNORE\t<motivo + capa que cubre el control>
   ```
2. **Requiere segunda firma**: CISO debe comentar el PR aprobando la
   excepción. Sin ese comentario, el reviewer no debe aprobar el cambio del
   `.zap/rules.tsv`.
3. Re-correr CI. El job ahora pasa.
4. Registrar en el log de excepciones (`segurasist-infra/docs/security/
   zap-exceptions.md` — si no existe, crearlo) con: ruleId, fecha, autor,
   firma CISO, motivo.

### Caso especial — ZAP timeout / infraestructura

Si el job falla por timeout (>15 min) o el container ZAP no levanta:
- Verificar que `docker compose up -d` en el step previo arrancó todos los
  servicios (`unhealthy=0`).
- Revisar log de `Wait for healthy` y `docker compose logs --tail 200`.
- Si es flake, re-run el job. Si reincide, abrir incidente de infra y NO
  desactivar el job (sería bypass de control).

## Postmortem template

Completar para cada incidente DAST que llegue a `main`:

- **Timeline (UTC):**
- **Finding:** Alert ID + descripción
- **Root cause:** (codepath / configuración faltante)
- **Fix PR:**
- **Detection gap:** ¿por qué Semgrep / unit tests no lo agarraron antes?
- **Action items (owner, due date):**
  - [ ] Test unit que reproduzca el finding y prevenga regresión
  - [ ] Regla Semgrep custom si aplica
  - [ ] Revisión cruzada de endpoints similares

## Métricas de tracking

- Cantidad de findings DAST por sprint (objetivo: tendencia decreciente).
- Tiempo medio de resolución (objetivo: < 24 h).
- Ratio falsos positivos / reales (si > 50%, refinar `.zap/rules.tsv`).
- Reglas IGNORE acumuladas (objetivo: revisión trimestral con CISO).
