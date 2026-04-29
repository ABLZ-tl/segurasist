# Code Freeze Checklist — Sprint 5 SegurAsist

- **Fecha objetivo Code Freeze**: día 29 Sprint 5 (24h pre Go-Live).
- **Fecha objetivo Go-Live**: día 30 Sprint 5.
- **Owner consolidación**: DS-1 (Design System Lead).
- **Estado**: borrador iter 1 — cada owner marca `[x]` cuando done.

> Regla dura: ningún ítem queda sin marca antes del Go-Live. Si una celda
> está en `[ ]` 4h antes del freeze → escalar a Tech Lead.

## 1. Tests

| Item | Owner | Estado | Notas |
| --- | --- | --- | --- |
| `pnpm -w typecheck` clean | todos | [ ] | Bloquea PR merge |
| `pnpm -w lint` clean | todos | [ ] | |
| `pnpm --filter segurasist-api test --run` 100% pass | backend | [ ] | Coverage 60/55/60/60 + security 80/75 |
| `pnpm --filter @segurasist/* test --run` 100% pass | DS-1 + MT-2 + MT-3 + S5-3 | [ ] | UI primitives + apps |
| `pnpm --filter admin test --run` | MT-2, S5-1, S5-3 | [ ] | |
| `pnpm --filter portal test --run` | MT-3, S5-3 | [ ] | |
| `pnpm --filter admin build` (Next prod) | MT-2 | [ ] | |
| `pnpm --filter portal build` (Next prod) | MT-3 | [ ] | |
| E2E `tests/e2e/multi-tenant-portal.spec.ts` | MT-4 | [ ] | Cross-leak |
| E2E `tests/e2e/admin-branding-roundtrip.spec.ts` | MT-4 | [ ] | Admin → portal |
| Visual regression baseline checked-in | MT-4 | [ ] | Playwright snapshot |
| k6 baseline `tests/performance/k6/sprint5-baseline.js` p95 OK | G-2 | [ ] | |
| ZAP DAST 0 High / 0 Medium endpoints públicos | G-2 | [ ] | |
| Coverage diff vs Sprint 4 (`docs/sprint5/COVERAGE_DIFF.md`) | MT-4 | [ ] | |

## 2. ADRs y runbooks

| Item | Owner | Estado |
| --- | --- | --- |
| ADR-0009 SAML SSO strategy | S5-1 | [ ] |
| ADR-0010 GuardDuty findings triage | S5-2 | [ ] |
| ADR-0011 RTO/RPO validados | G-1 | [ ] |
| ADR-0012 Motion design GSAP | DS-1 | [x] |
| ADR-0013 Brandable theming | DS-1 + MT-1 | [x] |
| RB-018 DR drill | G-1 | [ ] |
| RB-019 SAML onboarding | S5-1 | [ ] |
| RB-020 GuardDuty triage | S5-2 | [ ] |
| RB-021 Tenant branding onboarding | MT-1 + MT-2 | [ ] |
| DEVELOPER_GUIDE.md actualizado (≥ 5 anti-patterns Sprint 5) | MT-4 + DS-1 | [ ] |

## 3. Branding seed + tenants demo

| Item | Owner | Estado |
| --- | --- | --- |
| Tenant default `segurasist` con branding house | MT-1 | [ ] |
| Tenant `mac` (Hospitales MAC) seedeado con logo + colores | MT-1 + MT-2 | [ ] |
| Tenant `demo_insurer` sin branding (test default fallback) | MT-1 | [ ] |
| Logo MAC subido a S3 + CloudFront cache hit verificado | MT-1 | [ ] |
| Defaults `--tenant-*` en `tokens.css` correctos | DS-1 | [x] |

## 4. Env vars + secret rotation

| Item | Owner | Estado |
| --- | --- | --- |
| `.env.example` admin actualizado (NEXT_PUBLIC_*) | MT-2 | [ ] |
| `.env.example` portal actualizado | MT-3 | [ ] |
| `.env.example` API actualizado (SAML_CERT, SCIM_TOKEN, BRANDING_BUCKET, BRANDING_CDN_HOST) | S5-1 + MT-1 | [ ] |
| Secret rotation Cognito client | S5-2 | [ ] |
| Secret rotation DB password (post DR drill) | G-1 + S5-2 | [ ] |
| KMS key rotación 90d configurada | S5-2 | [ ] |

## 5. Monitoring + alarms

| Item | Owner | Estado |
| --- | --- | --- |
| CloudWatch alarms para 5xx admin / portal | S5-2 | [ ] |
| GuardDuty alarms a Slack (#sec-alerts) | S5-2 | [ ] |
| Security Hub findings dashboard | S5-2 | [ ] |
| Synthetic canary login admin | S5-2 | [ ] |
| Synthetic canary portal asegurado | S5-2 | [ ] |
| Synthetic canary chatbot | S5-3 | [ ] |
| RDS performance insights enabled | G-1 | [ ] |

## 6. Seguridad + CSP

| Item | Owner | Estado |
| --- | --- | --- |
| CSP admin extiende `script-src` + `connect-src` con `cdn.lordicon.com` | MT-1 + MT-2 | [ ] (NEW-FINDING DS-1) |
| CSP portal extiende `script-src` + `connect-src` con `cdn.lordicon.com` | MT-1 + MT-3 | [ ] (NEW-FINDING DS-1) |
| CSP `img-src` portal incluye CloudFront tenant branding | MT-3 | [ ] |
| CSP `img-src` admin incluye CloudFront tenant branding | MT-2 | [ ] |
| RLS policies cross-tenant-test verde | MT-4 | [ ] |
| `helmet`/`csurf` configurados desde `@segurasist/security` | MT-1 | [ ] |
| File magic-bytes validation logo upload | MT-1 | [ ] |

## 7. DR + backup

| Item | Owner | Estado |
| --- | --- | --- |
| DR drill ejecutado en staging | G-1 | [ ] |
| RTO ≤ 4h validado | G-1 | [ ] |
| RPO ≤ 15 min validado | G-1 | [ ] |
| S3 versioning verificado | G-1 | [ ] |
| Backup de RDS PITR test restore OK | G-1 | [ ] |

## 8. On-call y comunicación

| Item | Owner | Estado |
| --- | --- | --- |
| Roster on-call día 30 publicado | Tech Lead | [ ] |
| Página de status pública preparada | S5-2 | [ ] |
| Email a stakeholders MAC con horario Go-Live | Tech Lead | [ ] |
| Run-book "Go-Live cutover" listo | Tech Lead | [ ] |
| Plan de rollback documentado y probado | G-1 + Tech Lead | [ ] |

## 9. Documentación cliente-facing

| Item | Owner | Estado |
| --- | --- | --- |
| UAT script firmado por MAC (`docs/qa/UAT_SCRIPT.md`) | DS-1 | [ ] |
| Manual usuario portal asegurado | MT-3 | [ ] |
| Manual admin (branding + KB + SAML) | MT-2 + S5-1 + S5-3 | [ ] |
| Onboarding checklist tenants nuevos | MT-1 | [ ] |

## 10. Compliance + audit

| Item | Owner | Estado |
| --- | --- | --- |
| Audit log retention 90d configurada | MT-1 | [ ] |
| Conversation retention 30d cron en producción | S5-3 | [ ] |
| Sprint 5 DOR/DOD firmado | MT-4 + DS-1 | [ ] |

## Reglas de freeze

1. Ningún merge a `main` después del freeze sin aprobación Tech Lead.
2. Hotfix branches solo con label `hotfix/sprint5` y 2 reviewers.
3. Si un item se bloquea: marcar `BLOCKED: <razón>` y abrir issue.
4. DS-1 mantiene esta lista actualizada cada 6h hasta freeze.
