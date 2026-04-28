# Performance Scenarios — Sprint 4 / S4-10

Owners: **S8** (DevOps Performance).
Linked story: `S4-10` — JMeter scenarios + p95 ≤ 500 ms gate.

## Pre-requisitos

| Dependencia | Versión | Notas |
|---|---|---|
| JDK | 17+ | Apache JMeter requiere Java |
| Apache JMeter | 5.6.3 | El workflow CI fija esta versión |
| Node.js | 20.x | Para correr `data/generate-csv.mjs` |
| jq, bc | cualquiera | Parser JTL + checks numéricos |
| k6 (opcional) | 0.50+ | Scripts alternativos en `tests/performance/k6` |

## Staging environment requirements (OBLIGATORIO antes del primer run)

El gate de performance Sprint 4 corre **únicamente contra `staging`** y
requiere que las siguientes variables estén activas en el deploy del
backend (`segurasist-api`) en ese ambiente:

| Env var | Valor | Owner | Razón |
|---|---|---|---|
| `OTP_TEST_BYPASS` | `true` | S9 (hardening) + ops | El throttle de OTP (5 OTP/min por identifier en `auth.service.otpRequest`) bloquea el ramp-up de 1000 vu apenas ~5 segundos después del START. Sin el bypass, el escenario portal (`portal-load-1000.jmx`) reporta error rate ≥ 99% y el gate p95 falla por timeouts secundarios. |
| `RENAPO_VALIDATION_MODE` | `stub` | F2 + ops | Las llamadas reales a RENAPO en alta de asegurado son lentas (200-800 ms) y dependen de un servicio externo no productivo en staging; con `stub` la validación devuelve éxito determinista. |

**⚠ Política — solo en staging, NUNCA en prod**:

`OTP_TEST_BYPASS=true` desactiva el throttle de OTP por identificador
(CURP). En producción esto abre la puerta a enumeración + ataques de
fuerza bruta sobre el flow de login del portal asegurado. La política
de despliegue (S9 + producto) es:

- ✅ `dev`: bypass `true` por default (developer experience).
- ✅ `staging`: bypass `true` **solo** cuando se ejecuta el load test;
  apagar tras el run si la ventana es prolongada (Sprint 5: gate
  automático en GitHub Action que setea/desetea via SSM Parameter Store).
- ❌ `prod`: bypass **siempre** `false` o ausente. Si se detecta `true`
  en prod, la alarma `auth-otp-bypass-enabled-prod` (Sprint 5 backlog)
  dispara P1 y rota el deploy.

Coordinación pendiente (Sprint 5): producto + S9 deciden si exponer
`OTP_TEST_BYPASS` solo en staging vía SSM Parameter Store (más
auditable que `App Runner environment_variables` + Terraform plan
review obligatorio antes de cada cambio).

Variables de entorno (override por property `-J<KEY>=...`):

| Property | Default | Descripción |
|---|---|---|
| `BASE_URL` | `https://api.staging.segurasist.com` | Target API. **Nunca** apuntar a prod. |
| `VUS` | 1000 (portal) / 100 (admin) | Concurrencia |
| `RAMPUP_SECONDS` | 300 / 120 | Tiempo de subida |
| `DURATION_SECONDS` | 600 | Sustain |
| `TENANT_ID` | `hospitales-mac` | Cabecera `X-Tenant` |
| `JTL_OUT` | `results/<scenario>.jtl` | Path de salida CSV |

## Setup

```bash
# 1) Generar fixtures (1000 CURPs portal + 100 admins) — determinista, semilla 42/7.
node tests/performance/jmeter/data/generate-csv.mjs

# 2) Crear directorio de resultados.
mkdir -p tests/performance/jmeter/results

# 3) Verificar JMeter en PATH.
jmeter -v
```

## Ejecutar localmente

### Portal (1000 vu)

```bash
cd tests/performance/jmeter

jmeter -n \
  -t portal-load-1000.jmx \
  -JBASE_URL=https://api.staging.segurasist.com \
  -JVUS=1000 \
  -JRAMPUP_SECONDS=300 \
  -JDURATION_SECONDS=600 \
  -JJTL_OUT=results/portal-1000.jtl \
  -l results/portal-1000.jtl \
  -e -o results/portal-html
```

Tiempo estimado: 5 min ramp + 10 min sustain ≈ **16 min**.

Recursos: máquina con ≥ 8 GB RAM / 4 vCPU. JMeter sólo (sin GUI) puede
sostener 1000 vu si los HTTP samplers usan HttpClient4 (config aplicada
en el plan).

### Admin (100 vu)

```bash
jmeter -n \
  -t admin-load-100.jmx \
  -JBASE_URL=https://api.staging.segurasist.com \
  -JVUS=100 \
  -JRAMPUP_SECONDS=120 \
  -JDURATION_SECONDS=600 \
  -JJTL_OUT=results/admin-100.jtl \
  -l results/admin-100.jtl \
  -e -o results/admin-html
```

## Validar gates

```bash
chmod +x tests/performance/parse-jtl.sh

tests/performance/parse-jtl.sh tests/performance/jmeter/results/portal-1000.jtl
# {
#   "total": 145820, "errors": 12, "errorRatePct": 0.0082,
#   "p50": 124, "p95": 318, "p99": 487, "avg": 156, "max": 1820
# }

# Por endpoint:
tests/performance/parse-jtl.sh \
  tests/performance/jmeter/results/portal-1000.jtl \
  "POST /v1/chatbot/message"
```

Gates (definidos en `.github/workflows/perf.yml`):

- `p95 ≤ 500 ms` (global)
- `error rate ≤ 1%`

## k6 (alternativa)

```bash
cd tests/performance/k6

# Portal
BASE_URL=https://api.staging.segurasist.com \
  k6 run -e VUS=1000 -e RAMPUP=300 -e DURATION=600 portal.k6.js

# Admin
BASE_URL=https://api.staging.segurasist.com \
  k6 run -e VUS=100 -e RAMPUP=120 -e DURATION=600 admin.k6.js
```

k6 evalúa thresholds inline; el exit code != 0 si fallan.

## CI (GitHub Actions)

Workflow: `.github/workflows/perf.yml`

- Trigger manual: `gh workflow run perf.yml -f base_url=https://...`
- Trigger schedule: lunes 06:00 UTC.
- Sube artefactos `jmeter-results-<run>` (JTL + HTML report) con retention
  de 30 días.

## Troubleshooting

- **`OutOfMemoryError`**: aumentar heap → `HEAP="-Xms2g -Xmx6g"` antes de
  invocar `jmeter`.
- **OTP rechazado**: confirmar que staging tiene `OTP_TEST_BYPASS=true` y
  `RENAPO_VALIDATION_MODE=stub` activos. Sin esto el flow login fallará
  100%.
- **HTTP 429 (Throttle)**: el global throttle es 100 req/min/IP. Para load
  test desde un solo runner se requiere allowlist del IP del runner en
  WAF (ver F8 alarms.tf). Alternativa: distribuir VUs en varios runners
  via JMeter distributed mode (Sprint 5).
- **TLS handshake slow**: usar `-Jhttps.useEpoll=true` y verificar pool
  size en `HTTPSampler.concurrentPool` (default 6).

## Reproducibilidad

- Fixtures con seed determinista (42 portal / 7 admin).
- JMeter property `--use-old-sampler false` para obtener jitter realista.
- Reporte HTML auto-generado por `-e -o` flag — persistir como artifact.

## Roadmap

- Sprint 5: distributed JMeter (multi-runner) para alcanzar 5000 vu.
- Sprint 6: integrar New Relic / CloudWatch synthetic en paralelo para
  correlación BE.
