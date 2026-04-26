# segurasist-infra

Infraestructura como código (IaC) del SaaS multi-tenant SegurAsist.

- 100% AWS, region principal `mx-central-1`, DR `us-east-1`.
- Terraform 1.7+ con remote state S3 + DynamoDB lock + KMS encrypt.
- 6 cuentas AWS (Organizations): root, security, log-archive, dev, staging, prod.
- CI/CD vía GitHub Actions con OIDC (sin claves long-lived).

## Requisitos

- Terraform `>= 1.7.0, < 2.0.0`
- AWS CLI v2
- `gh` CLI (>= 2.40)
- `tflint` `>= 0.50`
- `terraform-docs` `>= 0.17`
- `pre-commit` `>= 3.5`
- Cuenta AWS con perfiles configurados (`segurasist-dev`, `segurasist-staging`, `segurasist-prod`).

## Pre-requisitos (one-time, fuera de este repo)

Antes de poder correr `make init` por primera vez:

1. **Cuentas AWS creadas vía Organizations** — ver `external/AWS-001` (procedimiento manual de
   creación de cuentas root + security + log-archive + dev + staging + prod).
2. **OIDC provider configurado por cuenta** — ver `external/GH-002` (provider GitHub OIDC,
   creado vía bootstrap script o consola la primera vez).
3. **Bucket S3 + tabla DynamoDB para tfstate** — bootstrap manual con `terraform/bootstrap/`
   (Sprint 0 a entregar). Por ambiente: `segurasist-tfstate-{env}` + `terraform-lock-{env}`.
4. **KMS CMK `alias/segurasist-tfstate`** — para cifrar el state.

## Estructura

```
segurasist-infra/
├── modules/                   # Módulos reusables (ver cada README.md)
├── envs/                      # Composición por ambiente
│   ├── dev/
│   ├── staging/
│   └── prod/
├── global/                    # Recursos cross-account
│   ├── organization/          # OUs + SCPs + IAM Identity Center
│   ├── security/              # GuardDuty / SH / Config / CloudTrail agg
│   ├── route53/               # Zona pública + ACM
│   └── iam-github-oidc/       # OIDC provider + roles deploy
├── .github/workflows/         # GitHub Actions
├── docs/
│   ├── adr/                   # Architecture Decision Records
│   ├── runbooks/              # RB-001 .. RB-010
│   └── security/              # IRP, breach notification
├── Makefile
└── README.md
```

## Comandos

```bash
# Formatear y validar
make fmt
make validate ENV=dev

# Inicializar backend
make init ENV=dev

# Plan / apply
make plan  ENV=dev
make apply ENV=dev

# Lint y docs
make lint
make docs

# Destroy (cuidado)
make destroy ENV=dev DESTROY=YES
```

## Política de promoción

```
feature-branch  ─PR─►  main          ─tag v*─►  release
       │                 │                          │
       │                 │                          │
   tf-plan dev       apply staging              apply prod (manual approval)
```

- **PR a `main`**: workflow `terraform-plan.yml` corre `fmt`, `validate`, `plan` por env afectado y comenta el resultado en el PR.
- **Push a `main`**: workflow `terraform-apply.yml` aplica a `staging`.
- **Tag `v*` (semver)**: aplica a `prod` con approval manual del environment `production` en GitHub.

## Naming convention

Recursos: `segurasist-{env}-{servicio}-{detalle}` (ej. `segurasist-prod-rds-main`).

Tags obligatorios en todos los recursos (vía `default_tags`):

| Tag        | Ejemplo        |
|------------|----------------|
| Project    | SegurAsist     |
| Env        | dev/staging/prod |
| Owner      | platform       |
| ManagedBy  | Terraform      |
| CostCtr    | MAC-MVP        |

## Reglas de calidad

- Defaults SEGUROS: cifrado ON, public-access OFF, deletion_protection ON donde aplique.
- Variables con `description` y `type` explícitos.
- Outputs solo de lo que otros módulos consumen.
- Nada de `count`; usar `for_each` con maps.
- Nada de account IDs ni ARNs hardcoded — usar `data.aws_caller_identity.current`.
- Pre-commit obligatorio: `terraform fmt`, `terraform validate`, `tflint`, `gitleaks`.

## Soporte

- Slack: `#segurasist-eng`, `#segurasist-alerts`.
- On-call rotation: ver `docs/runbooks/`.
- Incidentes: `docs/security/IRP.md`.
