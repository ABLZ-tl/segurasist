# SegurAsist — Monorepo Workspace

> Workspace local del MVP SegurAsist (Hospitales MAC). Coordina 3 repos y artefactos externos.

## Estructura

```
SaaS/
├── segurasist-api/     # Backend NestJS 10 + Prisma + Cognito (App Runner)
├── segurasist-web/     # Monorepo Next.js 14 (apps/admin + apps/portal)
├── segurasist-infra/   # Terraform 1.7+ + GitHub Actions (workflows)
├── external/           # Tareas que requieren acción del usuario (cuentas AWS, dominios, IdP, etc.)
├── docs/               # Documentación viva del proyecto
└── MVP_*.docx          # Suite documental fuente
```

## Convenciones de gobierno técnico

- **TDD obligatorio**: tests primero (Jest backend, Vitest frontend, Playwright E2E).
- **Cross-tenant gate**: cualquier endpoint con `tenant_id` debe tener test que valida 404 al cruzar tenants — bloquea el merge.
- **Branch protection**: `main` protegido; PRs requieren 1 reviewer + CI verde + cross-tenant + DAST.
- **Conventional Commits**: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `ci:`, `refactor:`, `security:`.
- **CODEOWNERS** definidos por repo.
- **0 secretos en código**: gitleaks pre-commit + en CI; AWS Secrets Manager + 1Password Business.
- **IaC obligatorio**: cero cambios manuales en consola AWS para recursos productivos.

## Cómo coordinar el desarrollo

1. Cada repo tiene su propio `README.md` con instrucciones detalladas para devs.
2. Los `external/` MDs marcan bloqueos que requieren acción manual del usuario (cliente final / Roy / DevOps con consola AWS).
3. El plan de sprints está en `MVP_02_Plan_Proyecto_SegurAsist.docx` (S1–S6).
4. Las decisiones arquitectónicas cerradas están en `MVP_03_Arquitectura_SegurAsist.docx` (ADRs 001–013).

## Pipeline general

```
PR → lint → test → security (SAST/SCA) → build → cross-tenant gate
   → deploy staging → DAST OWASP ZAP → smoke E2E
   → tag v* → approval Tech Lead/PM → deploy prod
```

## Estado del programa

Ver `docs/PROGRESS.md` (actualizado por el Tech Lead al cierre de cada sprint).

## Riesgos operativos vigentes

Hasta el cierre de Sprint 5 los buckets / logs / audit trail son **mutables**
(LocalStack + Postgres + Docker logs sin Object Lock). Si ocurre un incidente
en ese intervalo, la evidencia post-incidente puede haber sido alterada — el
Object Lock COMPLIANCE no aplica retroactivamente.

Detalle, mitigaciones interim (`pg_dump` programado + snapshot ante hallazgos)
y plan de cierre Sprint 5 en [`docs/INTERIM_RISKS.md`](./docs/INTERIM_RISKS.md).
