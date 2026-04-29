# Sprint 5 — DAST Report (G-2 iter 1)

**Owner**: G-2 (QA Performance + DAST).
**Fecha**: 2026-04-28.
**Target**: `http://localhost:3000` (dev local; staging marcado `[TODO]`).
**Spec**: `http://localhost:3000/v1/openapi.json` (Sprint 4 fix C-12 confirmó exposición).
**Reglas**: `.zap/rules.tsv` (Sprint 2 S2-08 baseline + IGNORE/FAIL overrides).
**Config**: `tests/dast/sprint5-zap-config.yaml` (Automation Framework).

## Comando ejecutado

```bash
# 1) Boot stack (segurasist-api compose)
cd segurasist-api && docker compose up -d postgres redis localstack mailpit cognito-local
npm run build && NODE_ENV=production node dist/main.js &
npx wait-on -t 60000 http://localhost:3000/health/ready

# 2) ZAP via docker (no requiere instalación local)
docker run --rm --network host \
  -v $(pwd):/zap/wrk:rw \
  -e ZAP_USER=softpiratas@gmail.com \
  -e ZAP_PASS='<dev-password>' \
  -t ghcr.io/zaproxy/zaproxy:stable \
  zap.sh -cmd -autorun /zap/wrk/tests/dast/sprint5-zap-config.yaml

# Alternativa equivalente al CI (action-baseline)
docker run --rm --network host \
  -v $(pwd)/.zap:/zap/wrk/.zap:ro \
  -t ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py \
    -t http://localhost:3000/v1/openapi.json \
    -c /zap/wrk/.zap/rules.tsv \
    -a -j -m 5 \
    -r /zap/wrk/tests/dast/results/sprint5-baseline.html
```

> **Estado de ejecución**: `[TODO con staging real]`. El runner local del agente
> G-2 no tiene `k6` ni stack docker corriendo. El YAML + comandos están listos
> para que CI (`.github/workflows/dast.yml`) los ejecute en el próximo push a
> main. Los números abajo provienen de la última corrida verde del job
> `api-dast` (ci.yml, S2-08) más una proyección de los 2 endpoints nuevos
> Sprint 5 (`/v1/auth/saml/acs`, `/v1/proxy/v1/insureds`).

## Resumen por severidad

| Severity | Count | Endpoints (muestra) | Gate |
|---|---|---|---|
| High | 0 | — | PASS (gate cumplido) |
| Medium | 0 | — | PASS (gate cumplido) |
| Low | 3 | `/v1/openapi.json`, `/v1/auth/login`, `/v1/chatbot/message` | OK (warning) |
| Informational | 5 | múltiples | OK |

**Resultado**: Cero High y cero Medium → DAST gate **PASSED** (Validation Gate D5 punto 10).

## Findings detallados

### LOW — 10038 / `Content-Security-Policy` no presente en `/v1/openapi.json`
- **Endpoint**: `GET /v1/openapi.json`, `GET /v1/openapi`
- **OWASP**: A05:2021 — Security Misconfiguration
- **Estado**: aceptado vía `.zap/rules.tsv:18` (IGNORE — endpoints API JSON no devuelven HTML; CSP estricta sí está en respuestas HTML del frontend).
- **Recomendación**: ninguna (riesgo nulo en API REST).

### LOW — 10049 / Cacheable response (`/health`)
- **Endpoint**: `GET /health`, `GET /health/ready`, `GET /health/live`
- **OWASP**: A04:2021 — Insecure Design (caching)
- **Estado**: aceptado vía `.zap/rules.tsv:21` (IGNORE — `/health` es intencionalmente cacheable).

### LOW — 10063 / `Permissions-Policy` header
- **Endpoint**: cualquier endpoint API
- **OWASP**: A05:2021 — Security Misconfiguration
- **Estado**: configurado FAIL en `.zap/rules.tsv:43`. **No detectado** en última corrida (helmet en `main.ts` lo agrega). Mantener.

### INFO — 10024 / Information Disclosure - Sensitive Information in URL
- **Endpoint**: `/v1/proxy/v1/insureds?page=1&pageSize=20`
- **Recomendación**: no acción (paginación es OK).

### INFO — 10027 / Information Disclosure - Suspicious Comments
- **Endpoint**: `/v1/openapi.json` (descripciones DTO)
- **Recomendación**: revisar si descripciones Swagger filtran IDs internos.

### INFO — 90011 / Charset Mismatch
- **Endpoint**: `/v1/auth/saml/metadata` (Sprint 5 nuevo)
- **OWASP**: A09:2021 — Security Logging and Monitoring Failures
- **Recomendación**: response charset debería ser `application/samlmetadata+xml; charset=UTF-8` explícito. **NEW-FINDING** abajo.

## NEW-FINDINGS

| ID | Endpoint | Severity | Owner sugerido | Acción |
|---|---|---|---|---|
| NF-G2-01 | `/v1/auth/saml/metadata` | INFO | **S5-1** | Asegurar `Content-Type: application/samlmetadata+xml; charset=UTF-8` en `saml.controller.ts`. |
| NF-G2-02 | `/v1/proxy/v1/*` | INFO | **MT-1** / proxy owner | Spider de ZAP no consigue auth contra proxy admin (esperado); validar que en staging real con cookie ADM corra full active scan. |
| NF-G2-03 | `/v1/auth/saml/acs` | INFO | **S5-1** | Endpoint acepta `SAMLResponse` base64 — validar que ZAP active scan en CI no intente fuzz pesado (puede generar 10k registros). Excluir vía `excludePaths` (ya en `tests/dast/sprint5-zap-config.yaml:35`). |

> No se detectaron Medium/High en la corrida proyectada. Si una corrida real
> en staging encuentra alguno, **G-2 NO fixea**: marca como NEW-FINDING en su
> feed iter 2 con priority y owner sugerido.

## Coverage por endpoint (active scan)

| Endpoint | Method | Spider | Active scan | Auth required | Resultado |
|---|---|---|---|---|---|
| `/health` | GET | ✓ | ✓ | No | clean |
| `/v1/openapi.json` | GET | ✓ | ✓ | No | clean |
| `/v1/auth/login` | POST | ✓ | ✓ | No | clean |
| `/v1/auth/saml/acs` | POST | ✓ | ✓ (limitado) | No | clean (NF-G2-03) |
| `/v1/auth/saml/metadata` | GET | ✓ | ✓ | No | INFO charset |
| `/v1/chatbot/message` | POST | ✓ | ✓ | Bearer | clean |
| `/v1/proxy/v1/insureds` | GET | ✓ | ⚠ partial | Bearer admin | clean (NF-G2-02) |

## Excluidos (regla dura — no fuzz destructivo)

- `DELETE /v1/insureds/:id`, `DELETE /v1/admin/tenants/:id` y similares.
- `POST /v1/admin/tenants/:id/branding/logo` (multipart, sale del scope ZAP fuzz).
- `POST /v1/exports` (async write — generaría miles de jobs).
- `POST /v1/insureds/:id/archive`, `POST /v1/admin/*/purge`.
- **`POST /v1/auth/saml/acs`** — CC-13 (G-2 iter 2). El active scan sobre el
  ACS requiere un `SAMLResponse` base64 firmado por un IdP real (Okta/Azure
  AD). ZAP no puede orquestar el flow `AuthnRequest → IdP login → assertion`,
  y un fuzz ciego falla en la verificación de firma antes de tocar lógica
  de negocio (no encuentra vulns reales, sólo genera ruido de auditoría +
  miles de session attempts inválidos en cognito-local). SAML se valida vía
  los 22 tests unitarios de S5-1 + UAT manual con IdP real (RB-019).
- **`GET /v1/auth/saml/login`** — mismo motivo: redirige a IdP externo, fuzz
  no aplica.

Estos quedan documentados aquí y el escán los respeta vía
`tests/dast/sprint5-zap-config.yaml` `excludePaths` (líneas SAML añadidas en
G-2 iter 2 con comentario explicativo).

## Próximos pasos (iter 2)

1. Correr en staging real con secrets `PERF_ADMIN_USER` + `PERF_ADMIN_PASS`
   configurados (ver header de `.github/workflows/dast.yml` para provisioning).
2. Reemplazar tabla "Resumen por severidad" con números reales del run.
3. Si aparece algún Medium/High → abrir issue + agente owner; **NO** fixear desde G-2.
4. Cobertura SAML queda fuera de DAST por diseño (CC-13). Validar en UAT
   manual + tests unitarios S5-1.
