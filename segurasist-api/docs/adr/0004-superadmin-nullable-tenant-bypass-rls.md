# ADR-0004 — Superadmin con `tenant_id` nullable + BYPASSRLS

- Status: Aceptado
- Fecha: 2026-04-26
- Decisores: Tech Lead, Backend Senior
- Items audit relacionados: M2 (User.tenant_id nullable), H3 (pool-aware JWT), M4 (env schema)

## Contexto

El rol `admin_segurasist` (superadmin) opera cross-tenant: lista todos los
tenants, crea nuevos, gestiona reportes consolidados. Antes de este ADR el
schema declaraba `users.tenant_id NOT NULL` y el seed asociaba al superadmin
al tenant `mac` como workaround. Eso provocaba tres problemas:

1. **Modelo incoherente**: el `JwtAuthGuard` no tenía branch para superadmin;
   un token de superadmin entregaba `tenantId='mac'` en `req.tenant` y el
   `PrismaService` seteaba `app.current_tenant=mac`. El superadmin podía leer
   datos del tenant `mac` por accidente sin que el RBAC se diera cuenta.
2. **Sentinel mágico (`GLOBAL`)**: el bootstrap de cognito-local emitía
   `custom:tenant_id=GLOBAL` para el superadmin. El JwtAuthGuard NO lo
   manejaba — era un valor inválido que pasaba sin chequeos.
3. **Falta de RLS bypass limpio**: cualquier query del superadmin debía
   reescribirse para no usar el `PrismaService` request-scoped (que asume
   `app.current_tenant`).

## Decisión

### 1. `users.tenant_id NULLABLE` con CHECK constraint

- Migración `20260426_superadmin_nullable_tenant`:
  ```sql
  ALTER TABLE users ALTER COLUMN tenant_id DROP NOT NULL;
  ALTER TABLE users ADD CONSTRAINT users_tenant_role_check
    CHECK ((tenant_id IS NULL AND role IN ('admin_segurasist'))
           OR (tenant_id IS NOT NULL));
  ```
- El schema Prisma refleja `tenantId String?`.
- El seed crea al superadmin con `tenantId: null`. La idempotencia del seed
  detecta seeds previos con `tenantId='mac'` y los migra a `null`.

### 2. JWT pool-aware (H3)

- El `JwtAuthGuard` valida `claims.aud` contra `COGNITO_CLIENT_ID_ADMIN` y
  `COGNITO_CLIENT_ID_INSURED` después del `jwtVerify`. Marca
  `req.user.pool='admin'|'insured'` según el match.
- Si el `aud` no matchea ningún client → 401 `AUTH_INVALID_TOKEN`.
- Si el token claim `custom:role=admin_segurasist` viene de pool insured
  (privilege escalation attempt) → `req.user.pool='insured'` y el
  `RolesGuard` rechaza por mismatch role/pool.

### 3. Branch superadmin en JwtAuthGuard

- Si `role === 'admin_segurasist' && pool === 'admin'`:
  - Setea `req.bypassRls = true`.
  - NO setea `req.tenant` (cross-tenant).
- Resto de roles: comportamiento previo (tenant context obligatorio).

### 4. RLS bypass por rol DB

- Roles DB:
  - `segurasist_app` (NOBYPASSRLS) — cliente del API normal.
  - `segurasist_admin` (BYPASSRLS) — cliente superadmin / writer auditoría.
- `PrismaService` (request-scoped, rol app) sigue funcionando igual. Cuando
  `req.bypassRls=true` simplemente NO setea `app.current_tenant`; las
  policies RLS bloquean toda lectura → 0 filas (defensa en profundidad).
- `PrismaBypassRlsService` (singleton, rol admin) es el cliente que los
  services superadmin DEBEN inyectar. Conecta con `DATABASE_URL_BYPASS`.

### 5. Defensa en profundidad

- 3 capas de control:
  1. **Cognito user pool**: superadmin solo existe en pool admin.
  2. **RolesGuard**: chequea `role+pool` matchean (admin-only roles solo
     desde pool admin).
  3. **RLS Postgres**: si un service superadmin se equivoca y usa el
     cliente normal, RLS devuelve 0 filas — el bug se manifiesta como lista
     vacía / 404, no como fuga cross-tenant.

### 6. Cognito-local bootstrap

- Se elimina el sentinel `custom:tenant_id=GLOBAL`. El superadmin queda sin
  el atributo (el JwtAuthGuard usa `custom:role` como señal).

## Consecuencias

### Positivas

- El superadmin queda correctamente modelado como cross-tenant.
- El privilege escalation latente (token insured con `custom:role` admin)
  queda bloqueado por dos capas independientes.
- El env schema cross-validates `COGNITO_ENDPOINT` en producción (M4): un
  atacante con acceso a Secrets Manager no puede redirigir JWKS a un host
  arbitrario.

### Negativas / a vigilar

- Cualquier nuevo service que tenga lógica superadmin DEBE inyectar
  `PrismaBypassRlsService` explícitamente. Olvidarlo se manifiesta como
  lista vacía (no como error) — agregamos un log warn cuando el
  `PrismaService` se usa con `bypassRls=true`.
- `DATABASE_URL_BYPASS` es una nueva env var: en prod debe pointar al rol
  `segurasist_admin` con password gestionado en Secrets Manager. Si está
  ausente, los paths superadmin lanzan `ForbiddenException` (degradación
  documentada).

## Referencias

- `prisma/migrations/20260426_superadmin_nullable_tenant/migration.sql`
- `src/common/guards/jwt-auth.guard.ts` (branch superadmin)
- `src/common/prisma/prisma-bypass-rls.service.ts`
- `prisma/rls/policies.sql`
- `test/security/cross-tenant.spec.ts` (2 tests nuevos)
- `test/e2e/superadmin.e2e-spec.ts`
