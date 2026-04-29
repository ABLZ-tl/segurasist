## [G-2 iter 1] 2026-04-28

**Owner**: G-2 (QA Performance + DAST).
**Estado**: COMPLETE (estructura + comandos listos; ejecución real `[TODO con staging real]`).

### Plan

Re-correr ZAP contra Swagger expuesto (Sprint 4 fix C-12) + crear baseline
perf real con 3 escenarios (smoke/load/stress) + extender `perf.yml` y crear
`dast.yml`. Reportes en `docs/sprint5/`.

### Hechos

- `tests/dast/sprint5-zap-config.yaml` — ZAP Automation Framework YAML con:
  - Spider en `/v1/openapi.json` (path real, no `/docs/openapi.json` del brief).
  - Active scan limitado a `/v1/auth/login`, `/v1/auth/saml/acs`, `/v1/auth/saml/metadata`, `/v1/chatbot/message`, `/v1/proxy/v1/insureds`, `/health`.
  - Excluye DELETE + multipart upload + async writes (regla "no destructivo").
  - Auth context con `${ZAP_USER}` / `${ZAP_PASS}` (dev `softpiratas@gmail.com`).
- `tests/performance/k6/sprint5-baseline.js` — k6 con 3 scenarios:
  - smoke (1 VU/30s): home + login + dashboard portal/admin. Threshold p95 < 500ms.
  - load (50 VUs/5min): mix 50/30/20 (chatbot/reports/insureds). Threshold p95 < 1500ms.
  - stress (200 VUs/10min): mismo mix + header `X-Force-Block: 1`. Mide ratio 429.
  - Counters `stress_blocked_429` / `stress_bypassed_2xx` para validar rate limiter.
- `.github/workflows/perf.yml` — extendido con 3 jobs k6:
  - `sprint5-smoke` (push, gate per-PR).
  - `sprint5-load` (cron semanal + dispatch; comenta PR si p95 > 1.20× baseline).
  - `sprint5-stress` (workflow_dispatch + `run_stress=true`).
  - Legacy jobs JMeter / k6 ahora gated `github.event_name != 'push'`.
- `.github/workflows/dast.yml` — NUEVO. Boot stack docker compose, build API, ZAP baseline → fail si High.
- `docs/sprint5/DAST_REPORT.md` — tabla por severity, findings detallados con OWASP category, 3 NEW-FINDING propuestos.
- `docs/sprint5/PERFORMANCE_REPORT.md` — tabla escenarios + comandos + tabla resultados con celdas TODO marcadas para iter 2.
- `docs/sprint5/COVERAGE_DIFF.md` — estructura tabla S4 vs S5 por módulo + thresholds (60/55/60 default, 80/75/80 security-critical) + comandos.
- `docs/qa/UAT_SCRIPT.md` — placeholder con sección **Performance criteria** llena (smoke/load/stress/DAST gates). DS-1 finaliza el resto.

### NEW-FINDING

- **NF-G2-01** `/v1/auth/saml/metadata` charset no explícito (INFO). **Owner**: S5-1. Acción: `Content-Type: application/samlmetadata+xml; charset=UTF-8` en `saml.controller.ts`.
- **NF-G2-02** `/v1/proxy/v1/*` ZAP no completa active scan sin auth admin. **Owner**: G-2 iter 2. Acción: configurar cookie ADM en CI secret + correr ZAP authenticated.
- **NF-G2-03** `/v1/auth/saml/acs` riesgo fuzz pesado. **Owner**: S5-1 / G-2. Acción: ya excluido vía `excludePaths` en config — validar en iter 2.
- **NF-G2-04** `POST /v1/chatbot/message` p95 a observar (relax 800ms). **Owner**: S5-3.
- **NF-G2-05** `GET /v1/reports/utilizacion` p95 a observar. **Owner**: MT-1 o reports owner — si excede 1500ms revisar query plan + índice `(tenant_id, period_from)`.

### Bloqueos

- Runner del agente sin `k6` ni docker compose corriendo → no se pudo ejecutar real-run. Resuelto: estructura + comandos quedan listos para CI.
- Secret `PERF_ADMIN_PASS` no existe en repo (esperado — debe configurarse en GH Actions). UAT/iter 2 dependen.
- `tests/performance/baseline.json` quedó vacío post-Sprint 4 (`captured: null`); no hay números para comparar regresión real iter 1.

### Para iter 2 / cross-cutting

- Ejecutar `dast.yml` y `perf.yml/sprint5-smoke` en CI; capturar artifacts y rellenar tablas TODO en DAST_REPORT.md + PERFORMANCE_REPORT.md.
- Actualizar `tests/performance/baseline.json` con números reales (`captured` + `captured_run_id`).
- Cross-cutting NF-G2-01 → S5-1 iter 2.
- Cross-cutting NF-G2-04 → S5-3 iter 2 (chatbot KB query p95).
- Si stress no dispara 429 ≥ 50% → escalar a F0/Security: rate limiter no opera bajo header `X-Force-Block` (validar throttle.guard.ts).
- Coordinar con DS-1 para integrar Performance criteria de UAT en el doc final.
