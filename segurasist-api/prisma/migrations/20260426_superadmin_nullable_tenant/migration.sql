-- M2 — Superadmin sin tenant + RLS bypass
--
-- Problema:
--   Hoy `users.tenant_id` es NOT NULL y el seed asocia el `admin_segurasist`
--   al tenant `mac` como workaround. Eso contradice el modelo cross-tenant
--   del superadmin: no hay branch en JwtAuthGuard, no hay RLS bypass
--   limpio y queda un footgun (puedes leer desde el tenant `mac` con un
--   token de superadmin si te equivocas en el guard).
--
-- Solución:
--   1) `tenant_id` NULLABLE.
--   2) CHECK constraint que sólo permite NULL si `role='admin_segurasist'`.
--   3) (Migración independiente, ver `prisma/rls/policies.sql`) — el superadmin
--      usa el rol DB `segurasist_admin` (BYPASSRLS); los services superadmin
--      inyectan `PrismaBypassRlsService`. El cliente normal sigue rol
--      `segurasist_app` (NOBYPASSRLS): si el superadmin intenta leer con él
--      sin tenant context, RLS lo bloquea — defensa en profundidad.
--
-- Compatibilidad: el seed superadmin (`tenantId: 'mac'`) deja de aplicar.
-- `prisma/seed.ts` se actualiza en este mismo cambio para crear el superadmin
-- con `tenantId: null`.

-- 1) Drop NOT NULL.
ALTER TABLE "users" ALTER COLUMN "tenant_id" DROP NOT NULL;

-- 2) CHECK: NULL solo si role='admin_segurasist'. Cualquier otro role debe
--    traer tenant_id. Defendemos contra inserts inconsistentes a nivel BD.
ALTER TABLE "users"
  DROP CONSTRAINT IF EXISTS "users_tenant_role_check";
ALTER TABLE "users"
  ADD CONSTRAINT "users_tenant_role_check"
  CHECK (
    (tenant_id IS NULL AND role IN ('admin_segurasist'))
    OR
    (tenant_id IS NOT NULL)
  );
