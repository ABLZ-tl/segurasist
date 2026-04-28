# `.github/` — CI/CD config

Esta carpeta está pre-armada para cuando **GH-001** desbloquee (creación del
GitHub Org `segurasist` con sus 3 repos privados — ver
`external/GH-001-github-org-repos.md`).

## Estado actual

Los workflows viven aquí pero **no se ejecutan todavía** porque:
- El repo aún no está pusheado a GitHub
- El org no existe (bloqueo externo)

Cuando GH-001 se desbloquee:
1. Crear el repo en `github.com/segurasist`
2. `git remote add origin git@github.com:segurasist/<nombre>.git`
3. `git push -u origin main`
4. CI corre automáticamente en cada push y PR

## Workflows

| Archivo | Propósito |
|---|---|
| [`workflows/ci.yml`](workflows/ci.yml) | Lint + typecheck + unit + e2e + SAST + DAST contra `segurasist-api` y `segurasist-web` con detección de cambios por path-filter |

## Quality gates

Todo PR a `main` debe pasar el check agregado `ci-success`, que combina:

| Gate | Tooling | Falla si |
|---|---|---|
| Lint + typecheck | ESLint + tsc | warnings / errors de TS |
| Unit / E2E | Jest + Vitest | tests rojos o cobertura < umbral |
| SAST (código) | Semgrep (`p/owasp-top-ten`, `p/jwt`, `p/secrets`, `p/nodejs`, `p/react`, `p/nextjs`) | finding `--error` |
| Dependencias | `npm audit` / `pnpm audit` + dependency-review-action | CVE `high+critical` o licencia `GPL-3.0` / `AGPL-3.0` |
| **DAST (runtime)** | **OWASP ZAP baseline (S2-08)** | **finding con `risk_code >= 3` (HIGH)** |

### DAST — OWASP ZAP

- Jobs: `api-dast` y `web-dast` (matrix `admin` / `portal`).
- Scope: passive scan + AJAX spider sobre la app levantada en el runner.
  - `api-dast` apunta a `http://localhost:3000/v1/openapi.json`; ZAP descubre
    cada endpoint declarado en la spec OpenAPI y lo escanea automáticamente.
    **Ergonomía**: si agregas un endpoint nuevo y lo expones en la spec, ZAP
    lo recorre sin tocar CI.
  - `web-dast` apunta a `http://localhost:3001/login` y `http://localhost:3002/`.
- Reglas custom: [`.zap/rules.tsv`](../.zap/rules.tsv) — IGNORE para FPs
  conocidos, FAIL para checks críticos elevados.
- Reporte HTML disponible como artifact (`zap-report-api`,
  `zap-report-web-admin`, `zap-report-web-portal`).
- Local: `./scripts/run-zap-baseline.sh [api|admin|portal] [--full]`.
- Runbook si el job falla: [`segurasist-infra/docs/runbooks/RB-015-dast-failure.md`](../segurasist-infra/docs/runbooks/RB-015-dast-failure.md) (renumerado desde `RB-011` en F8 iter 2).

## Branch protection recomendado (post GH-001)

En `main`:
- Require pull request before merging (1 approval mínimo)
- Require status checks to pass: `ci-success`
- Require branches to be up to date before merging
- Require linear history
- Block force pushes

## Pendiente para Sprint 5

- `workflows/deploy-api.yml` — App Runner deploy con OIDC (necesita GH-002)
- `workflows/deploy-web.yml` — Amplify Hosting deploy con OIDC
- `workflows/release.yml` — semver tagging + changelog automatizado
- Dependabot config en `.github/dependabot.yml`
