# Sprint 4 Report — S8 Performance (S4-10)

## Iter 1

### Historias cerradas

- **S4-10** (5 pts) — Performance test JMeter — escenarios + CI gate
  + parser + baseline skeleton. Estado: **artefactos completos**, ejecución
  real diferida (sandbox sin staging — F0 corre el primer run).

### Files creados / modificados

10 archivos nuevos, 0 modificados.

| Path | Tipo | LOC aprox |
|---|---|---|
| `tests/performance/jmeter/portal-load-1000.jmx` | JMeter plan XML | 290 |
| `tests/performance/jmeter/admin-load-100.jmx` | JMeter plan XML | 280 |
| `tests/performance/jmeter/data/generate-csv.mjs` | ESM script | 55 |
| `tests/performance/jmeter/data/insureds.csv` | fixture | 100 filas |
| `tests/performance/jmeter/data/admins.csv` | fixture | 100 filas |
| `tests/performance/jmeter/data/README.md` | docs | 60 |
| `tests/performance/jmeter/scenarios/README.md` | runbook | 130 |
| `tests/performance/k6/portal.k6.js` | k6 script | 160 |
| `tests/performance/k6/admin.k6.js` | k6 script | 160 |
| `tests/performance/parse-jtl.sh` | bash parser | 95 |
| `tests/performance/baseline.json` | baseline skeleton | 90 |
| `.github/workflows/perf.yml` | GH Action | 165 |
| `docs/sprint4/PERFORMANCE_REPORT.md` | reporte | 130 |
| `docs/sprint4/feed/S8-iter1.md` | feed | 70 |

### Tests añadidos

- N/A para unit/integ (S8 owns infra de tests, no código de producción).
- "Tests" en este contexto = **escenarios JMeter + k6** que ejercitan los
  endpoints owned por S1/S5/S6/S7 bajo carga.
- Validación local del parser:
  - `parse-jtl.sh` se prueba manualmente con un JTL de muestra; falta
    `parse-jtl.spec.sh` (bats-core) — backlog Iter 2.

### Tests existentes

- ✅ N/A — el sub-proyecto `tests/performance/` es nuevo, no rompe
  pipelines actuales (`changes` filter de `ci.yml` no lo incluye → no
  dispara CI extra).

### Cross-cutting findings

Ver `docs/sprint4/feed/S8-iter1.md` (6 entries):

1. OTP bypass requerido en staging (→ S9).
2. WAF allowlist runner GHA (→ S3).
3. Chatbot gate p95 800 ms documentado (→ S5).
4. Reports cache (→ S1).
5. Audit timeline index (→ S7).
6. DoD Sprint 4 incluir gate perf (→ S10).

## Iter 2 (planificado)

- Rellenar `baseline.json` con valores reales tras primer run.
- Agregar test del parser (bats-core o jest+execa).
- Distribuir VUs en JMeter distributed mode (multi-runner) — Sprint 5
  realmente.
- Per-endpoint regression detection (`baseline-compare.sh` que falle si
  `actual > 1.2 × baseline`).
- Coordinaciones:
  - **S9**: confirmar bypass envs.
  - **S3**: WAF rules.
  - **S10**: integrar checklist DoD.

## Compliance impact (DoR/DoD por historia)

### S4-10

- [x] DoR: criterio MVP_07 ratificado (p95 ≤ 500 ms, error ≤ 1%).
- [x] DoR: scenarios documentados con mix justificado.
- [x] DoR: data fixtures determinísticos.
- [x] DoD: `.jmx` + `.k6.js` ejecutables.
- [x] DoD: CI workflow con gate (manual + cron).
- [x] DoD: parser JTL → JSON estandarizado.
- [x] DoD: documentación reproducible (`scenarios/README.md`).
- [x] DoD: baseline schema definido (valores null hasta primer run real).
- [ ] DoD-blocker: ejecución real contra staging (depende F0/CI/staging).

## Lecciones para DEVELOPER_GUIDE.md

1. **Performance budgets per-endpoint > global**. El gate global (500 ms)
   no es suficiente — endpoints específicos necesitan budgets más estrictos
   (read = 300 ms) o más laxos (chatbot = 800 ms). Estos viven en
   `baseline.json` y son revisados en cada PR de `tests/performance/**`.

2. **Load test data debe ser determinístico**. Seed fija (42 portal, 7 admin)
   para que dos runs sean comparables. Evitar `Math.random()` sin seed.

3. **Throughput Controller > Random Controller**. JMeter Random Controller
   no garantiza distribución exacta del mix; Throughput Controller (style=1
   percent) sí.

4. **Login una vez por VU**. `OnceOnlyController` evita explosión de
   tokens y refleja patrón real (un usuario no re-loguea cada request).
   Beneficio: el Cookie Manager + JSON extractor mantienen el token vivo
   toda la sesión.

5. **CI gate como `workflow_dispatch` + cron, NO en PR**. El load test
   contra staging cuesta tiempo+dinero; correrlo en cada PR es anti-DX.
   La regla: `perf.yml` corre semanal + on-demand, los PRs siguen un
   light-smoke (futuro: 10 vu × 1 min en `ci.yml` para detectar regresión
   gruesa).

6. **JMeter binario, no Docker action**. Las actions docker para JMeter
   tienen versiones desactualizadas o no soportan `-J<KEY>` consistente.
   Bajar el tarball oficial es 30s y 100% predecible.
