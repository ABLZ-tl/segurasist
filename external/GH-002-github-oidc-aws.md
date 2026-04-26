# GH-002 — GitHub Actions OIDC con AWS (sin claves)

**Estado:** ⬜ Pendiente
**Bloquea:** Deploys automáticos a staging/prod
**Owner:** DevOps Lead
**Depende de:** AWS-001, GH-001
**Referencia:** `MVP_06_DevOps_IaC_SegurAsist.docx` §6.2 + §7

## Contexto

GitHub Actions puede asumir roles IAM en AWS sin necesidad de access keys de larga vida usando **OIDC federation**. Esto elimina el riesgo de keys filtradas en logs o repos.

## Pasos

### 1. Crear OIDC Identity Provider en cada cuenta AWS (dev, staging, prod)

Para cada cuenta:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

> El thumbprint es el SHA-1 del certificado raíz de GitHub. Verificar versión actual en https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services.

### 2. Crear roles IAM por repo + ambiente

Los archivos Terraform están en `segurasist-infra/global/iam/github-oidc/`. Roles que necesitamos:

| Cuenta | Rol | Repos permitidos | Permission set |
|---|---|---|---|
| dev | `github-actions-deploy-dev` | `segurasist/segurasist-*` | DeployDev (ECR push, App Runner deploy, Amplify start, Lambda update) |
| staging | `github-actions-deploy-staging` | `segurasist/segurasist-*` ref `main` | DeployStaging (igual + RDS migrate) |
| prod | `github-actions-deploy-prod` | `segurasist/segurasist-*` tag `v*` | DeployProd (igual + manual approval requerido) |
| prod | `github-actions-tf-plan-prod` | `segurasist/segurasist-infra` PRs | terraform plan only (read) |
| prod | `github-actions-tf-apply-prod` | `segurasist/segurasist-infra` tag `v*` | terraform apply (manual approval) |

### 3. Trust policy ejemplo (rol `github-actions-deploy-staging`)

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:segurasist/segurasist-*:ref:refs/heads/main"
      }
    }
  }]
}
```

> El `sub` claim limita por org/repo/ref. Para tags: `repo:segurasist/segurasist-*:ref:refs/tags/v*`.

### 4. Configurar GitHub Environments (en cada repo)

Settings → Environments → "New environment":

- `staging` — sin protection rules.
- `production` — Required reviewers: PM + Tech Lead. Wait timer: 5 min.

En cada environment, definir secrets:
- `AWS_ACCOUNT_DEV`, `AWS_ACCOUNT_STAGING`, `AWS_ACCOUNT_PROD` (no son secretos pero los usamos como variables sensibles).
- `ECR_REGISTRY` (URL del registro).

### 5. Workflow ejemplo (en `segurasist-api/.github/workflows/api-ci.yml`)

```yaml
permissions:
  id-token: write   # OIDC
  contents: read

jobs:
  deploy-staging:
    environment: staging
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ vars.AWS_ACCOUNT_STAGING }}:role/github-actions-deploy-staging
          aws-region: mx-central-1
```

> **Nota:** `${{ vars.X }}` para variables públicas; `${{ secrets.X }}` para secretas. Account IDs van en vars.

## Evidencia esperada

- [ ] OIDC provider creado en cada cuenta (`aws iam list-open-id-connect-providers`)
- [ ] Roles IAM creados con trust policy correcta
- [ ] Environments `staging` y `production` configurados con required reviewers en prod
- [ ] Workflow de prueba en cualquier repo asume el rol exitosamente

## Verificación rápida

Crear un workflow `oidc-test.yml` que solo haga `aws sts get-caller-identity`:

```yaml
on: workflow_dispatch
permissions: { id-token: write, contents: read }
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ vars.AWS_ACCOUNT_STAGING }}:role/github-actions-deploy-staging
          aws-region: mx-central-1
      - run: aws sts get-caller-identity
```

## Costo

$0 — OIDC federation es gratis.
