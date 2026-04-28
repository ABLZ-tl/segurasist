# Performance Report — Sprint 4 / S4-10

**Owner**: S8 (DevOps Performance)
**Status**: Iter 1 — escenarios y CI gate creados; **baseline pendiente** de
ejecución contra staging real (F0/CI corre el primer run y rellena
`tests/performance/baseline.json`).

## SLOs ratificados (MVP_07)

| Métrica | Target | Gate CI |
|---|---|---|
| p95 latencia API global | ≤ 500 ms | **fail si > 500 ms** |
| p99 latencia API global | ≤ 1500 ms | warn |
| Error rate (HTTP 4xx/5xx no esperados) | ≤ 1% | **fail si > 1%** |
| Disponibilidad sostenida bajo carga | 100% por 10 min | implícito (load test sin caídas) |

Gates más laxos por endpoint (justificados):

| Endpoint | guard p95 | Razón |
|---|---|---|
| `POST /v1/chatbot/message` | 800 ms | KB lookup + LLM/regex matcher |
| `POST /v1/insureds` | 700 ms | RENAPO stub + audit + write path |
| `GET /v1/reports/conciliacion` | 1500 ms | report agregado, query pesada |
| `GET /v1/audit/timeline` | 700 ms | join audit_logs + cursor pagination |
| `POST /v1/exports` | 2000 ms | acepta async (202) — sólo enqueue |

## Escenarios implementados

### Portal (1000 vu, 15 min total)

`tests/performance/jmeter/portal-load-1000.jmx` + `tests/performance/k6/portal.k6.js`

- **Login OTP** una vez por VU (cached). `accessToken` extraído por
  `JSONPostProcessor`, inyectado como `Authorization: Bearer` en el resto
  de samples.
- **Mix throughput-controlado**:
  - 30% `GET /v1/insureds/me`
  - 25% `GET /v1/insureds/me/coverages`
  - 20% `GET /v1/certificates/mine`
  - 15% `POST /v1/chatbot/message`
  - 10% `POST /v1/claims`
- Think time gaussiano 1–3 s.
- Ramp-up 5 min → sustain 10 min → tear-down 30 s.

### Admin (100 vu, 12 min total)

`tests/performance/jmeter/admin-load-100.jmx` + `tests/performance/k6/admin.k6.js`

- Login email/password una vez por VU.
- Mix: list / batches / create / patch / reports / audit-timeline / exports.
- Ramp-up 2 min → sustain 10 min → tear-down 30 s.

## CI gate

`.github/workflows/perf.yml`

- Trigger: `workflow_dispatch` (parametrizable BASE_URL/VUs/duration/tool)
  + cron semanal lunes 06:00 UTC.
- Steps:
  1. Setup Node + JMeter 5.6.3 (binary tar.gz oficial, no Docker).
  2. `node generate-csv.mjs` → genera fixtures determinísticas (1000+100).
  3. Corre portal-load-1000.jmx + admin-load-100.jmx contra `BASE_URL`.
  4. `parse-jtl.sh` agrega métricas → JSON.
  5. `bc -l` evalúa `p95 > 500` y `errorRate > 1` → exit code.
  6. Per-endpoint breakdown loggeado (no falla, sólo informa).
  7. Artifacts: `.jtl` + HTML report (retention 30 d).
- **NO bloquea PRs** (no es required check). Sí publica annotations
  `::error::` para visibilidad en la UI de Actions.

## Datos test

- `tests/performance/jmeter/data/insureds.csv` — 100 filas committeadas;
  `generate-csv.mjs` produce 1000 al correr.
- `tests/performance/jmeter/data/admins.csv` — 100 admins.
- CURPs sintéticos (shape válido, RENAPO inválido). Staging seed debe
  tener `OTP_TEST_BYPASS=true` y `RENAPO_VALIDATION_MODE=stub`.

## Decisiones de diseño

1. **JMeter como source of truth, k6 como dev-iteration**. JMeter genera
   `.jmx` XML estándar (auditable). k6 más rápido para iterar localmente
   (`k6 run script.js` 1 segundo de startup vs JMeter 8 s).
2. **Throughput Controller** en lugar de Random Controller para garantizar
   distribución exacta del mix (30/25/20/15/10).
3. **Login una vez por VU** vía `OnceOnlyController`. Modela usuarios
   reales (no re-login en cada request).
4. **CSV recyclable**: 100 CURPs × 1000 VU = 10 VUs comparten cada token.
   Para fidelidad 1:1 correr `generate-csv.mjs` antes (1000 únicos).
5. **HttpClient4** en HTTP defaults (Java 11 nativo no soporta
   `concurrentPool` y degrada a >500 vu).
6. **No en main CI**: el load test cuesta 16 min de runner GitHub +
   carga real a staging. `workflow_dispatch` evita ejecuciones
   accidentales.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| WAF bloquea por throttle desde IP única del runner | Allowlist en `segurasist-infra/modules/waf` (Sprint 5). Workaround corto: `RAMPUP_SECONDS=600` para suavizar |
| OTP rate limit (5 OTP/min) reventará el ramp-up | Staging tiene bypass `OTP_TEST_BYPASS=true` documentado en runbook |
| Cognito-local no escala a 1000 vu | El test corre contra **staging** con Cognito real (us-east-1), no localstack |
| Costos egress AWS desde GHA | Run semanal único — coste estimado <$2/run |

## Pendientes Iter 2 / Sprint 5

- [ ] Capturar baseline real tras primer run (rellenar `baseline.json`).
- [ ] Coordinar con S9 para garantizar que las migraciones de Sprint 4
  estén aplicadas antes del run (timeline + chatbot + KB).
- [ ] Distributed JMeter (5000 vu) — Sprint 5.
- [ ] Correlación CloudWatch metrics (CPU/memoria ECS) durante el run
  para detectar bottleneck DB vs app.
- [ ] Agregar gate a PRs `[perf]` opt-in (label-driven).

## Archivos creados

```
tests/performance/
├── baseline.json
├── parse-jtl.sh
├── jmeter/
│   ├── portal-load-1000.jmx
│   ├── admin-load-100.jmx
│   ├── data/
│   │   ├── README.md
│   │   ├── generate-csv.mjs
│   │   ├── insureds.csv
│   │   └── admins.csv
│   └── scenarios/
│       └── README.md
└── k6/
    ├── portal.k6.js
    └── admin.k6.js

.github/workflows/perf.yml
docs/sprint4/PERFORMANCE_REPORT.md
docs/sprint4/feed/S8-iter1.md
docs/sprint4/S8-report.md
```
