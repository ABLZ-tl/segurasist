-- Sprint 4 — extensión del enum `audit_action` para los nuevos dominios
-- (chatbot + reports + cron mensual). Antes de iter 1 los services de Sprint 4
-- codificaban el sub-action en `resourceType` o `payloadDiff.subAction`/`event`
-- como workaround:
--
--   - S5 (KbService.processMessage): `action='create'` + `resourceType='chatbot.message'`
--     + `payloadDiff.event='chatbot.message'`. Causaba que la query
--     "todos los mensajes del chatbot del último mes" requiriera scan en JSON.
--
--   - S6 (EscalationService): `action='update'` + `payloadDiff.subAction='escalated'`.
--     Mismo problema; además colisiona con audit de mutaciones reales de la
--     conversación (status update por cron). Sin enum value granular es
--     imposible distinguir un evento de escalamiento del re-status del cron.
--
--   - S1 (Reports): `action='export_downloaded'` para descargas de PDF/XLSX
--     (ok porque ya existe), pero la GENERACIÓN del reporte (paso previo,
--     puppeteer + xlsx render) se cubría con `action='read_viewed'`. Confunde
--     la diferencia "vio el JSON" vs "generó artefacto serializado".
--
--   - S3 (cron mensual): `action='create'` + `resourceType='report.monthly'`.
--     Mismo issue que S5 — necesitamos diferenciar un envío auto-cron de un
--     export bajo demanda para alertas y compliance reports.
--
-- S10 (NEW-FINDING-S10-03) consolidó la petición de los 4 nuevos valores;
-- agrego también `monthly_report_sent` solicitado por el dispatch del orquestador.
--
-- Postgres 12+ soporta `ALTER TYPE ... ADD VALUE IF NOT EXISTS` sin downtime.
-- Cada `ADD VALUE` corre en su propia sentencia idempotente; si la migración
-- se re-aplica (e.g. local-dev tras reset parcial), las que ya existen pasan
-- silenciosamente. Las filas previamente escritas con el workaround NO se
-- re-escriben automáticamente — los services migran a los nuevos valores en
-- sus respectivos iter 2 (S5 lo hace en este mismo iter 2; S1/S3/S6 quedan
-- en backlog del feed).

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'chatbot_message_sent';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'chatbot_escalated';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'report_generated';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'report_downloaded';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'monthly_report_sent';
