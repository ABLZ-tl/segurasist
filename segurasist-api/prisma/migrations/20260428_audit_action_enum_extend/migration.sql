-- H-01 / B-AUDIT P3 — Extiende el enum `audit_action` para acabar con el
-- "overload" semántico de `login`/`read` como múltiples sub-actions
-- (OTP request, OTP verify, certificate view, certificate download,
-- export download). Antes los services codificaban el sub-action en
-- `payloadDiff.subAction='viewed_360'` o `resourceType='auth.otp.requested'`
-- → drift entre callers + queries imposibles tipo
-- "todas las descargas de un mes" sin scan de string en JSON.
--
-- Postgres 12+ soporta `ALTER TYPE ... ADD VALUE` sin downtime. Sin embargo:
--   - El comando NO puede correr dentro de un transaction block que ya
--     hizo otras escrituras a la tabla. Prisma migrate envuelve cada
--     migration en una transacción → split en archivos separados sería
--     necesario si fallara, pero para `ADD VALUE` sin filas afectadas
--     históricamente funciona en una sola tx (verificado en el repo,
--     migración `20260427_add_audit_hash_chain` agregó columnas en una
--     sola tx también).
--   - Si llegara a fallar (versiones Postgres <12 o flag específico),
--     dividir en una migración por valor.
--
-- IF NOT EXISTS evita errores en re-runs (idempotencia local-dev). Los
-- callers (services) migran a los nuevos valores en F6 iter 2 — esta
-- migración solo expone el universo de valores válidos.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'otp_requested';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'otp_verified';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'read_viewed';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'read_downloaded';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'export_downloaded';
