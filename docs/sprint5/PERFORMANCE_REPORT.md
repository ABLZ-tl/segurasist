# Sprint 5 — Performance Report (G-2 iter 1)

**Owner**: G-2 (QA Performance + DAST).
**Fecha**: 2026-04-28.
**Scenarios file**: `tests/performance/k6/sprint5-baseline.js` (NUEVO Sprint 5).
**Predecesor**: `tests/performance/k6/{portal,admin}.k6.js` (Sprint 4 / S4-10).
**Baseline JSON**: `tests/performance/baseline.json` (mantener formato — actualizar tras run real).

## Escenarios

| Scenario | VUs | Duration | Mix | Threshold p95 | Threshold err |
|---|---|---|---|---|---|
| **smoke** | 1 | 30s | home (`/health`) + login + portal dashboard + admin dashboard | < 500 ms | < 1% |
| **load** | 50 ramp | 5 min | 50% `POST /chatbot/message`, 30% `GET /reports/utilizacion`, 20% `GET /insureds` paginated | < 1500 ms | < 1% |
| **stress** | 200 ramp | 10 min | mismo mix + header `X-Force-Block: 1` | n/a (mide 429%) | < 5% |

## Comandos

```bash
# Smoke (CI per-push)
BASE_URL=http://localhost:3000 SCENARIO=smoke \
  k6 run tests/performance/k6/sprint5-baseline.js

# Load (CI cron semanal o staging on-demand)
BASE_URL=https://api.staging.segurasist.com SCENARIO=load \
  ADMIN_EMAIL=$ADMIN_EMAIL ADMIN_PASS=$ADMIN_PASS \
  k6 run tests/performance/k6/sprint5-baseline.js

# Stress (workflow_dispatch manual)
BASE_URL=https://api.staging.segurasist.com SCENARIO=stress \
  k6 run tests/performance/k6/sprint5-baseline.js
```

## Resultados — `[TODO con staging real]`

> Iter 1 deja la estructura. Iter 2 (post staging access) llena celdas
> reemplazando los `TODO` por el output de
> `results/sprint5-{smoke,load,stress}-summary.json`.

### Smoke (1 VU, 30s)

| Endpoint | p50 (ms) | p95 (ms) | p99 (ms) | RPS | Errors |
|---|---|---|---|---|---|
| `GET /health` | TODO | TODO | TODO | TODO | TODO |
| `POST /v1/auth/login` | TODO | TODO | TODO | TODO | TODO |
| `GET /v1/insureds/me` (portal dashboard) | TODO | TODO | TODO | TODO | TODO |
| `GET /v1/admin/tenants` (admin dashboard) | TODO | TODO | TODO | TODO | TODO |

**Gate p95 < 500ms**: `[TODO]`

### Load (50 VUs, 5 min)

| Endpoint | p50 (ms) | p95 (ms) | p99 (ms) | RPS | Errors |
|---|---|---|---|---|---|
| `POST /v1/chatbot/message` | TODO | TODO | TODO | TODO | TODO |
| `GET /v1/reports/utilizacion` | TODO | TODO | TODO | TODO | TODO |
| `GET /v1/insureds` (paginated) | TODO | TODO | TODO | TODO | TODO |

**Gate p95 < 1500ms**: `[TODO]`

### Stress (200 VUs, 10 min)

| Métrica | Valor | Esperado |
|---|---|---|
| Total requests | TODO | — |
| HTTP 429 (rate limited) | TODO | ≥ 50% del total |
| HTTP 2xx (bypassed) | TODO | < 50% del total |
| Error rate (5xx + timeouts) | TODO | < 5% |
| Mean p95 (informativo) | TODO | n/a (no aplica gate) |

## Comparación vs Sprint 4 baseline

`tests/performance/baseline.json` está vacío (Sprint 4 no llegó a popular tras
S4-10 — ver `_instructions[]`). Iter 2 G-2 actualizará ambos `baseline.json` +
esta sección con deltas.

| Endpoint | Sprint 4 p95 | Sprint 5 p95 | Delta | Verdict |
|---|---|---|---|---|
| `GET /v1/insureds/me` | TODO | TODO | TODO | TODO |
| `POST /v1/chatbot/message` | TODO | TODO | TODO | TODO |
| `GET /v1/reports/conciliacion` | TODO | TODO | TODO | TODO |
| `GET /v1/insureds` (admin) | TODO | TODO | TODO | TODO |

## Endpoints lentos (>500ms p95) — NEW-FINDINGs

| ID | Endpoint | p95 observado | Threshold | Owner sugerido | Acción |
|---|---|---|---|---|---|
| NF-G2-04 | `POST /v1/chatbot/message` | TODO | 800ms (relax) | **S5-3** | Validar KB lookup p95 (Sprint 4 ya identificado). |
| NF-G2-05 | `GET /v1/reports/utilizacion` | TODO | 1500ms | **MT-1** o reports owner | Si > 1500ms revisar query plan + índice `(tenant_id, period_from)`. |

> Estos NEW-FINDING quedan en `feed/G-2-iter1.md` con priority. NO fixear desde
> G-2 (regla dura del brief).

## Configuración CI (resumen — full en `.github/workflows/perf.yml`)

| Trigger | Job | Scenario | Gate |
|---|---|---|---|
| `push` (segurasist-api/**) | `sprint5-smoke` | smoke | p95 < 500ms / err < 1% |
| `schedule` (lunes 06:00 UTC) | `sprint5-load` + `jmeter` | load | p95 < 1500ms; comenta PR si regresión > 20% vs baseline.json |
| `workflow_dispatch` con `run_stress=true` | `sprint5-stress` | stress | err < 5% |

## Risks & assumptions

- ZAP/k6 no instalados en runner del agente; test local no ejecutado. Iter 2
  ejecuta vía CI con secrets `PERF_ADMIN_EMAIL` + `PERF_ADMIN_PASS`.
- Stress scenario asume header `X-Force-Block: 1` reconocido por throttler. Si
  no (legacy), validar que la simple presión de 200 VUs sin sleep dispare 429.
- Endpoint `/v1/reports/utilizacion` puede no existir todavía (Sprint 5 in
  flight) — fallback acepta 4xx como esperado en smoke.
