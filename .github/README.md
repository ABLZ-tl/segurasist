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
| [`workflows/ci.yml`](workflows/ci.yml) | Lint + typecheck + unit + e2e contra `segurasist-api` y `segurasist-web` con detección de cambios por path-filter |

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
