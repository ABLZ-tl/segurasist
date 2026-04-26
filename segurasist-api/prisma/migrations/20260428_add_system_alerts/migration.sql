-- S2-04 — System alerts (bounce rate, email infra, etc).
-- Multi-tenant opcional: tenant_id NULL => alerta global SegurAsist.

CREATE TABLE "system_alerts" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"   UUID,
  "severity"    VARCHAR(16) NOT NULL,
  "code"        VARCHAR(64) NOT NULL,
  "message"     TEXT NOT NULL,
  "context"     JSONB,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3)
);

CREATE INDEX "system_alerts_severity_occurred_at_idx"
  ON "system_alerts" ("severity", "occurred_at" DESC);

CREATE INDEX "system_alerts_tenant_id_occurred_at_idx"
  ON "system_alerts" ("tenant_id", "occurred_at" DESC);

-- system_alerts NO tiene RLS por defecto (alertas globales).
-- Si en el futuro se vuelve tenant-only, agregar policy similar a las demás
-- en prisma/rls/policies.sql.
