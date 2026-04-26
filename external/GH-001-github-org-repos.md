# GH-001 — GitHub Org + 3 repos privados + Branch Protection + Advanced Security

**Estado:** ⬜ Pendiente
**Bloquea:** CI/CD (workflows no pueden vivir sin repos)
**Owner:** DevOps Lead + Tech Lead
**Referencia:** `MVP_06_DevOps_IaC_SegurAsist.docx` §6 + `MVP_02_Plan_Proyecto_SegurAsist.docx` §3 (Sprint 0)

## Contexto

Necesitamos una organización GitHub privada con 3 repos separados (no monorepo) — esto permite pipelines independientes y permisos granulares por equipo (Backend, Frontend, DevOps).

## Pasos

### 1. Crear organización GitHub

- https://github.com/organizations/new
- Plan: **Team** ($4/usuario/mes) — incluye 3,000 min de Actions y Advanced Security básico.
- Nombre sugerido: `segurasist`
- Email: `aws-root@segurasist.app` o un alias administrativo.

### 2. Crear los 3 repos privados (vacíos, sin README)

| Repo | Visibilidad | Default branch | Description |
|---|---|---|---|
| `segurasist-api` | Private | `main` | Backend NestJS + Prisma + Workers Lambda |
| `segurasist-web` | Private | `main` | Frontend monorepo Next.js 14 (admin + portal) |
| `segurasist-infra` | Private | `main` | Terraform + GitHub Actions + Runbooks |

> **Tip:** crearlos vacíos para luego hacer `git push -u origin main` desde local cuando los bootstrappee con código.

### 3. Branch Protection en `main` (los 3 repos)

Settings → Branches → "Add rule" para `main`:
- ✅ Require a pull request before merging
  - Require approvals: **1** (mínimo)
  - Dismiss stale approvals when new commits are pushed
  - Require review from CODEOWNERS
- ✅ Require status checks to pass before merging
  - Require branches to be up to date
  - Status checks (se irán agregando conforme creemos workflows): `lint`, `test`, `security`, `cross-tenant`, `build`
- ✅ Require conversation resolution before merging
- ✅ Require signed commits (GPG/SSH)
- ✅ Require linear history
- ✅ Do not allow bypassing the above settings (incluye admins)

### 4. Activar GitHub Advanced Security

Settings → Code security and analysis (por repo):
- ✅ Dependabot alerts
- ✅ Dependabot security updates
- ✅ Dependabot version updates (config en `.github/dependabot.yml` que generaré)
- ✅ Secret scanning + Push protection
- ✅ Code scanning (CodeQL — workflow auto-generado)

### 5. CODEOWNERS por repo

Cada repo tendrá su `.github/CODEOWNERS` (te lo genero yo en bootstrap), pero requiere que los handles existan. Sugerencia mínima inicial:

```
# segurasist-api
* @segurasist/backend-leads
/prisma/ @segurasist/backend-leads @segurasist/tech-leads
/test/security/ @segurasist/qa-leads @segurasist/backend-leads
```

Crea los teams en la org:
- `tech-leads`
- `backend-leads`
- `frontend-leads`
- `devops-leads`
- `qa-leads`
- `cisos`

### 6. Settings de la org

- Organization → Settings → "Member privileges"
  - Base permissions: **Read** (no push directo)
  - Repository creation: Disabled (solo owners crean repos)
  - Repository deletion: Disabled (excepto owners)
- Organization → Settings → "Repository defaults" → require 2FA for all members.
- Organization → Settings → "Verified domains" → verificar `segurasist.app`.

### 7. Tokens y secretos

- **NO crear PATs** (Personal Access Tokens) para CI/CD: usaremos OIDC con AWS (ver `GH-002`).
- Para integraciones externas (Slack notifications, etc.) usar **GitHub App** dedicada por integración.

## Evidencia esperada

- [ ] Org `segurasist` visible en GitHub
- [ ] 3 repos privados creados y vacíos
- [ ] Branch protection activa en `main` de los 3 (capturas)
- [ ] Advanced Security ON
- [ ] Teams creados con al menos 1 owner

## Notas

- El plan **Team** es suficiente para el MVP. Si en Fase 2 necesitamos SAML SSO, métricas avanzadas o más minutos de Actions, evaluar **Enterprise Cloud** ($21/usuario/mes).
- Los 3,000 min/mes de Actions del plan Team alcanzan para ~150 PRs/mes con pipelines típicos del MVP. Si nos quedamos cortos, comprar minutos adicionales ($0.008/min) o auto-hospedar runners en cuenta `dev`.
