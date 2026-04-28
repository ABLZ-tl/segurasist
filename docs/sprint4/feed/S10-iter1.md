# S10 — Iter 1 feed (QA Lead + Tech Writer)

> Bundle: Tests E2E features Sprint 4 + DoR/DoD validation + DEVELOPER_GUIDE update.

## Entradas (formato del `_features-feed.md`)

```
[S10] 2026-04-27 14:10 iter1 STARTED docs/sprint4/feed/S10-iter1.md — leyendo MVP_07 §3.5/3.6 + MVP_02 §9 + DEVELOPER_GUIDE §1-§8
[S10] 2026-04-27 14:25 iter1 DONE docs/qa/SPRINT4_DOR_DOD.md — matriz DoR/DoD por historia S4-01..10 con leyenda + rollup + 4 NEW-FINDINGs
[S10] 2026-04-27 14:50 iter1 DONE segurasist-api/test/e2e/sprint4-features.e2e-spec.ts — 16 tests E2E (reports + chatbot + audit-timeline + cross-tenant) con graceful-skip pattern
[S10] 2026-04-27 15:05 iter1 DONE docs/fixes/DEVELOPER_GUIDE.md §2.6/§2.7/§2.8 — secciones agregar chart-report / KB-entry / EventBridge-cron + 10 lecciones cross-bundle Sprint 4
[S10] 2026-04-27 15:10 iter1 NEW-FINDING docs/qa/SPRINT4_DOR_DOD.md§5 — policies.sql necesita 'kb_entries' + 'chat_tickets' (S5/S6 owners); validar iter 2
[S10] 2026-04-27 15:11 iter1 NEW-FINDING docs/qa/SPRINT4_DOR_DOD.md§5 — enum AuditAction necesita 4 valores nuevos (report_generated, report_downloaded, chatbot_message_sent, chatbot_escalated); migration UNIFICADA S1+S5+S6
[S10] 2026-04-27 15:12 iter1 NEW-FINDING docs/qa/SPRINT4_DOR_DOD.md§5 — coverage-summary.json diff iter1 vs iter2 obligatorio; sin él, % global puede caer silenciosamente
[S10] 2026-04-27 15:14 iter1 NEEDS-COORDINATION S5+S6 - cross-tenant test bot KB requiere fixture data (TENANT_A KB-A, TENANT_B KB-B, mismo keyword); coordino fixture en iter 2
[S10] 2026-04-27 15:20 iter1 iter1-complete docs/sprint4/S10-report.md — 3 deliverables OWNED + 4 findings; validation gate D4 documentado para iter 2
```

## Resumen rápido

### Files OWNED entregados (4)

| Path | Estado | Notas |
|---|---|---|
| `segurasist-api/test/e2e/sprint4-features.e2e-spec.ts` | ✅ NUEVO | 3 describe: Reportes (S4-01..03), Chatbot (S4-05..08), Audit timeline (S4-09). 16 tests con asserts reales + graceful-skip si bootstrap falla. NO `it.todo`. |
| `docs/qa/SPRINT4_DOR_DOD.md` | ✅ NUEVO | Matriz DoR (10/10 cleared) + DoD por historia (10 historias × 17 criterios = 170 cells). Validation gate D4 + 4 NEW-FINDINGs. |
| `docs/fixes/DEVELOPER_GUIDE.md` | ✅ EXTENDIDO | §2.6 chart/report (S1+S2), §2.7 chatbot KB entry (S5+S6), §2.8 EventBridge cron (S3) + 10 lecciones Sprint 4 cross-bundle al final §8. |
| `docs/sprint4/S10-report.md` | ✅ NUEVO | Reporte ejecutivo iter 1. Iter 2 será consolidador final. |

### NEW-FINDINGs (4)

1. **`policies.sql` array** debe extenderse con `'kb_entries'` y `'chat_tickets'` en el mismo PR de S5/S6. Drift garantizado si no, según §1.6 anti-pattern. (Tripwire: `apply-rls-idempotency.spec.ts`).
2. **enum `AuditAction`** necesita 4 valores nuevos. Coordinar S1+S5+S6 para una migration unificada `<DATE>_audit_action_sprint4` (vs. 4 separadas) por idempotencia + reduce reconfiguración del PG enum cache.
3. **Coverage diff iter1↔iter2 obligatorio**: sin `coverage-summary.json` snapshot, una caída del % global pasa silenciosa aunque módulos nuevos tengan 80%.
4. **JMeter perf gate Sprint 4 (S8)** debe correr **post-merge staging**, no PR-time. Coordinación crítica S1 (queries) + S8 (gate) + S10 (validation D4): si la nueva query de reports degrada admin p95 >600 ms, bloquear release-to-staging.

### Coordinaciones requeridas iter 2

- **S1 (Reports BE)**: confirmar contrato de `/v1/reports/conciliation/download?format=pdf|xlsx`. El spec actual tolera 200/302 (presigned redirect). Cuando S1 commitee implementación, ajustar asserts a 200 + content-type específico.
- **S5+S6 (Chatbot)**: fixture cross-tenant KB para `chatbot-cross-tenant.spec.ts` (TENANT_A keyword='plan' answer='A-only'; TENANT_B mismo keyword answer='B-only'). S10 valida en iter 2 que el insured tenant A nunca recibe `B-only`.
- **S7 (Audit timeline)**: confirmar shape del CSV export (`Content-Type: text/csv` + UTF-8 BOM si se quiere compatibilidad Excel ES-MX). Spec actual valida primer header line.
- **S9 (ADRs)**: ADR-0003 (sqs/eventbridge idempotency) referenciado en DEVELOPER_GUIDE §2.8 lección 5.

### Validation gate D4 — checklist iter 2

Ver `docs/qa/SPRINT4_DOR_DOD.md` §3. Items críticos:
- TS strict + ESLint web limpio.
- Suite tests >1100 + nuevos S4 (estimado ~1240).
- Cross-tenant tests presentes para chatbot + reports + audit timeline.
- Migrations idempotentes (`prisma migrate diff` sin diff post re-aplicación).
- E2E spec corre con stack si `RLS_E2E=1` o equivalente.

## Reglas observadas

- ✅ NO modificado código S1-S9 (verificado: solo `docs/` y `test/e2e/` propios).
- ✅ NO docker, install, commits.
- ✅ E2E spec con asserts reales (NO `it.todo` per DEVELOPER_GUIDE §1.5).
- ✅ DEVELOPER_GUIDE.md mantenido coherente con §1 anti-patterns y §5 PR checklist.
- ✅ Solo iter 1 — iter 2 es consolidador.
