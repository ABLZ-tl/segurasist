# Auditoría Exhaustiva — Sprint 3 closure

Auditoría distribuida con 10 sub-agentes paralelos. Cada uno revisa un área específica del repo en paralelo, módulo por módulo, endpoint por endpoint, test por test.

## Áreas auditadas

| # | Área | Reporte |
|---|---|---|
| A1 | Auth + RBAC + JWT + MFA | `01-auth-rbac.md` |
| A2 | Multi-tenant + RLS + Prisma | `02-multitenant-rls.md` |
| A3 | Batches (carga masiva + parser + validator + workers) | `03-batches.md` |
| A4 | Certificates + PDF + Email + SES | `04-certificates-email.md` |
| A5 | Insureds + Coverages + Packages + Reports | `05-insureds-reports.md` |
| A6 | Audit log + Throttler + Hardening | `06-audit-throttler.md` |
| A7 | Frontend admin (apps/admin) | `07-frontend-admin.md` |
| A8 | Frontend portal (apps/portal) | `08-frontend-portal.md` |
| A9 | DevOps + Terraform + IaC + scripts | `09-devops-iac.md` |
| A10 | Tests structure + DX + linting + docs | `10-tests-dx.md` |

## Bitácora compartida

`_findings-feed.md` — append-only feed entre agentes. Cada agente:

- Lee este archivo al iniciar (puede haber findings de agentes que arrancaron antes).
- Append una línea cuando encuentra un finding **cross-cutting** (afecta a otra área).
- Re-lee periódicamente durante la auditoría.

Formato de cada línea:

```
[<área>] <YYYY-MM-DD HH:MM> <SEV> <file:line> — <descripción corta> // <impacto en otras áreas>
```

`SEV ∈ {Critical, High, Medium, Low}`.

## Categorías de hallazgo

- **Maintainability** — código duplicado, abstracciones débiles, naming inconsistente.
- **Clarity** — lógica obscura, falta de comentarios donde se necesitan, intent ambiguo.
- **Structure** — archivos en carpetas equivocadas, módulos demasiado grandes, dependencias circulares.
- **Pattern** — desviación de NestJS conventions, React/Next.js anti-patterns.
- **Test-coverage** — tests faltantes, weak assertions, mocks mal configurados.
- **Security** — validación faltante, leakage de PII, RBAC débil.
- **Performance** — N+1 queries, render loops, cache mal usado.
- **DX** — fricción al onboarding, comandos inconsistentes, build lento.

## Severidades

- **Critical** — bug que rompe funcionalidad o introduce vulnerabilidad explotable.
- **High** — fix prioritario antes de Go-Live.
- **Medium** — fix razonable Sprint 4.
- **Low** — pulido, nice-to-have.

## Output esperado por sub-agente

`docs/audit/<NN>-<area>.md` con estructura:

```markdown
# Audit Report — <Área> (<NN>)

## Summary (≤10 líneas)

## Files audited
- (count + paths)

## Strengths (qué está bien hecho)

## Issues found
| ID | File:line | Severity | Category | Description | Recommendation |
|---|---|---|---|---|---|

## Cross-cutting concerns (afectan a otras áreas)
- (apend al feed compartido)

## Recommendations Sprint 4
- (top 3-5 acciones concretas)
```

## Reglas estrictas

- **READ-ONLY**: NO modificar código durante la auditoría.
- **NO** correr `npm install`, `docker`, `curl`. Solo análisis estático + lectura.
- **SI** correr `grep`, `find`, `wc`, `cat`, `head`, `tail`, `Read` para análisis.
- Output en UN MD por sub-agente. NO crear archivos extras salvo el feed compartido.
- Cada finding con `file:line` específico (no genérico).
- Aceptable reportar 0 issues si el área está limpia.

## Consolidación post-auditoría

Tras los 10 reportes, el Tech Lead consolida en `docs/audit/AUDIT_INDEX.md` con priorización y plan de remediación Sprint 4.
