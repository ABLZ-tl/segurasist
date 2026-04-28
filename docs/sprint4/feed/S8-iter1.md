# S8 — Iter 1 — Feed entries

## DONE

- **S4-10** Performance test JMeter (5 pts) — escenarios + CI gate creados.
  - `tests/performance/jmeter/portal-load-1000.jmx` (1000 vu, mix 30/25/20/15/10)
  - `tests/performance/jmeter/admin-load-100.jmx` (100 vu, CRUD + reports + exports)
  - `tests/performance/k6/{portal,admin}.k6.js` (alternativa moderna)
  - `tests/performance/parse-jtl.sh` (parser JTL → JSON p50/p95/p99/error)
  - `tests/performance/jmeter/data/{insureds,admins}.csv` + `generate-csv.mjs`
  - `tests/performance/baseline.json` (skeleton, valores null hasta primer run)
  - `.github/workflows/perf.yml` (manual + cron lunes 06:00 UTC)
  - `docs/sprint4/PERFORMANCE_REPORT.md`
  - `tests/performance/jmeter/scenarios/README.md`
- Load test **NO ejecutado** (sandbox no tiene staging accesible — dispatch rule).
- Gate definido: `p95 ≤ 500 ms` + `error rate ≤ 1%` (fail con `bc -l`).

## NEW-FINDINGS (cross-cutting → owners notificados)

1. **[S9 / hardening]** OTP rate limit (`5 OTP/min` por identifier) bloqueará
   el ramp-up de 1000 vu si no hay bypass. Recomendación: env
   `OTP_TEST_BYPASS=true` en staging + `RENAPO_VALIDATION_MODE=stub`.
   Owner: **S9** confirmar que el bypass está activo en `segurasist-infra/envs/staging`.

2. **[S3 / WAF]** El runner GHA usa una IP única → throttle global
   (100 req/min) saturará al subir a 1000 vu. Necesario allowlist o
   exempt-route en WAF para User-Agent `JMeter/SegurAsist-S4-10*`. Owner:
   **F8 alarms / S3 infra**.

3. **[S5 / chatbot]** El gate per-endpoint del chatbot usa `p95 ≤ 800 ms`
   (más laxo que global 500 ms). Justificado por LLM/regex matcher pero
   debe quedar documentado en `docs/sprint4/PERFORMANCE_REPORT.md`. Si el
   matcher final excede 800 ms se rompe el gate per-endpoint.

4. **[S1 / reports]** `GET /v1/reports/conciliacion` con guard 1500 ms es
   excepción — si la query agregada no está cacheada se va de baseline
   fácil. Sugerencia a **S1**: materialized view o cache Redis 5 min.

5. **[S7 / audit timeline]** La query timeline con `pageSize=50` y join
   completo audit_logs puede exceder 700 ms si no hay índice
   `(insured_id, created_at desc)`. Owner: **S7** verificar índice en
   migración Sprint 4.

6. **[S10 / QA]** Agregar a `SPRINT4_DOR_DOD.md` el bullet:
   "Performance gate ejecutado al menos una vez contra staging antes de
   cerrar Sprint 4". El gate manual workflow `perf.yml` permite
   despachar bajo demanda.

## ASKS

- **F0 / S0**: agendar el primer run de `perf.yml` contra staging tras la
  merge de las historias S4-01..S4-09 para capturar baseline real.
- **S9**: confirmar `OTP_TEST_BYPASS` y `RENAPO_VALIDATION_MODE` en staging.
- **S3**: definir allowlist WAF (o variabilizar throttle por UA test).
- **S10**: incluir gate perf en checklist DoD Sprint 4.

## Iter 2 plan (preview)

- Tras primer run: rellenar `baseline.json` con valores reales.
- Si gate falla: triage por endpoint usando breakdown del `parse-jtl.sh`,
  abrir issues por endpoint individual.
- Documentar runbook de troubleshooting expandido en `scenarios/README.md`.
