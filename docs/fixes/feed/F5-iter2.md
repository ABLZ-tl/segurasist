## F5 iter 2 — B-INFRA-SQS + B-WEBHOOK follow-ups

[F5] 2026-04-28 09:00 iter2 STARTED — F4 cleanup verification + drain runbook + deps re-confirm.

[F5] 2026-04-28 09:05 iter2 NEW-FINDING segurasist-api/src/workers/insureds-creation-worker.service.ts:73-86 — F4 NO ejecutó iter 2 cleanup. `String.replace('layout-validation-queue', 'insureds-creation-queue')` SIGUE presente con fail-fast guard, a pesar de que F3 ya publicó `SQS_QUEUE_INSUREDS_CREATION` en src/config/env.schema.ts:86 (verificado). Worker debería leer `env.SQS_QUEUE_INSUREDS_CREATION` directo. Owner F4 iter 2 (no toco workers — no es mi scope). Sin esto, H-29 sigue partial.

[F5] 2026-04-28 09:08 iter2 NEW-FINDING dedupeId callers — los 5 callers identificados en mi iter 1 NEW-FINDING SIGUEN pasando el 3er argumento a `sqs.sendMessage`:
  - `segurasist-api/src/modules/batches/batches.service.ts:443` (`${id}:${r.rowNumber}`) ✗ aún presente
  - `segurasist-api/src/modules/batches/batches.service.ts:648` (`${batchId}:preview_ready`) ✗ aún presente (NB: línea fue 619 en iter 1, ahora 648 por refactor)
  - `segurasist-api/src/workers/insureds-creation-worker.service.ts:167` (`${createdInsuredId}:created`) ✗ aún presente
  - `segurasist-api/src/workers/insureds-creation-worker.service.ts:332` (`${batchId}:completed`) ✗ aún presente
  - `segurasist-api/src/workers/layout-worker.service.ts:185` (`${batchId}:preview_ready`) ✗ aún presente
Reconfirmo: NO se propaga al SDK gracias al refactor estructural de `SqsService` (firma `sendMessage(queueUrl, body)` — el 3er arg es ignorado por TS al ser undefined en la signatura). Pero el código zombie sigue confundiendo. Owner F4 iter 2.

[F5] 2026-04-28 09:10 iter2 DONE segurasist-infra/docs/runbooks/RB-014-sqs-topic-rename-drain.md (NEW) — runbook P2 para el rename `<env>-certificates` → `<env>-pdf` en Sprint 5 apply. Estructura: Symptom → Detection → Pre-apply checklist (5 pasos: confirm plan, pause publishers, drain queue, verify DLQ empty, backup tfstate) → Apply (3 pasos) → Verify (smoke + CloudWatch + validation gate) → Postmortem checklist + Rollback. Cross-link RB-004 (DLQ peek) y C-09. Slot RB-014 verificado libre (RB-013 audit-tampering es el último ocupado).

[F5] 2026-04-28 09:12 iter2 DONE segurasist-api/package.json — verificación post-iter1: `@nestjs/swagger@7.4.0` (línea 50), `aws-sns-validator@0.0.6` (línea 53), `nestjs-zod@3.0.0` (línea 61) → las 3 deps que agregué en iter 1 SIGUEN presentes; nadie las removió. F8 iter 1 las consumió en main.ts:9,74-103 (Swagger wiring) — coordinación cerrada.

[F5] 2026-04-28 09:14 iter2 NEEDS-COORDINATION F8 — RB-014 menciona ventana de mantenimiento staging 30 min / prod 60 min. F8 (DevOps Senior) debe orquestar la fecha + comms B2B + status page (si existe). Mi runbook documenta el procedimiento técnico; F8 lo ejecuta en Sprint 5.

[F5] 2026-04-28 09:15 iter2 iter2-complete — F4 cleanup VERIFIED-MISSING (2 NEW-FINDINGs: String.replace + 5 dedupeId callers, owner F4 iter 2). RB-014-sqs-topic-rename-drain.md creado. Deps Swagger/SNS-validator/nestjs-zod re-confirmadas en package.json. NO toqué workers (F4 owner) ni env.schema.ts (F3 owner). Tests no corridos (sandbox bloquea pnpm). Validation gate orquestador: re-correr `pnpm test -- sqs webhook` post-merge F4 iter 2.
