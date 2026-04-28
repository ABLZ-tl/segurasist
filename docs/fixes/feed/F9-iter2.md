# F9 — feed entries iter 2

> Bundle: B-COVERAGE + B-CROSS-TENANT + B-TESTS-* (follow-ups iter 1).
> Append-only. F0 orquestador integra estas entradas a `docs/fixes/_fixes-feed.md`.

```
[F9] 2026-04-27 22:00 iter2 STARTED — engine check + downstream test fixes (NEW-FINDING #1, #2 from iter1) + DEVELOPER_GUIDE.md lessons.

[F9] 2026-04-27 22:05 iter2 DONE engines.node verified — Node 20+ confirmed across the stack:
  • `segurasist-web/package.json:7-9` → `"engines": { "node": ">=20.0.0" }`.
  • `segurasist-api/package.json:7-10` → `"engines": { "node": ">=20.11.0 <21", "npm": ">=10.0.0" }`.
  • `.github/workflows/ci.yml:43` → `NODE_VERSION: '20.11.x'` (referenced 9 times).
  • No `.nvmrc` present at repo root (CI relies on `engines` field + workflow env).
  Node 20 ships `crypto.randomUUID()` natively in `globalThis.crypto` (since Node 14.17 / 19+ globalThis); jsdom env in `packages/api-client/vitest.config.ts` inherits Node `globalThis.crypto`. NO polyfill needed. NEW-FINDING iter 1 #2 closed.

[F9] 2026-04-27 22:15 iter2 SKIPPED auth/insureds/certificates spec audit-shape update — F6 iter 2 (audit migration `auth.service.ts:240,339`, `insureds.service.ts:604`, `certificates.service.ts:238`) NO ha corrido todavía. Source code aún usa shape viejo (`action: 'login'`/`action: 'read'`); los specs en `src/modules/{auth,insureds,certificates}/<name>.service.spec.ts` están alineados con ese shape (insureds.service.spec.ts:344 `action: 'read'`, certificates.service.spec.ts:91 `action: 'read'`, auth.service.spec.ts NO mockea `auditWriter.record`). Si yo modificara los specs ahora a `read_viewed`/`read_downloaded`/`otp_requested`/`otp_verified` antes de F6, los specs FALLARÍAN contra el source actual. Acción correcta: F9 iter 3 (post-F6 iter 2) ajusta el shape; F6 iter 2 puede coordinar en su propio dispatch si toca los specs en el mismo PR. Documentado handoff F6→F9 abajo en NEW-FINDING.

[F9] 2026-04-27 22:20 iter2 SKIPPED admin threshold adjustment — validation gate F0 NO ha ejecutado pnpm tests (sandbox sigue bloqueando). Sin failure reportado, NO bajamos el threshold a priori (per instrucciones explícitas: "NO bajes a priori — solo si validation gate F0 reporta failure"). El comentario inline en `apps/admin/vitest.config.ts:36-45` ya documenta el ramp a 70/65 en Sprint 5; si F0 reporta caída del coverage gate post-merge, F9 iter 3 baja transitorio a 50/45/50/50 con TODO Sprint 5.

[F9] 2026-04-27 22:35 iter2 DONE DEVELOPER_GUIDE.md lessons (sección F10) — patrones tests para integrar:
  1. `describe.each(MATRIX)` para suites de cross-tenant HTTP (template AUDIT_INDEX style): bootstrap dinámico AppModule + Fastify, login una vez por suite, matriz de endpoints (verb+path+expectedDenied), asserts mínimos `status NUNCA 200/204` + `body NO leak<regex>`. Skip-safe (warn) si Postgres/Cognito no available — NUNCA `it.todo` ni `xit`.
  2. Coverage threshold real vs façade: `coverage.include` enumerativo (lista archivo-por-archivo) crea façade — los archivos no listados se EXCLUYEN del cálculo. Patrón correcto: `include: ['app/**', 'lib/**', 'components/**']` (carpetas amplias) + `exclude: [...]` granular para artefactos sin lógica (types, layouts triviales, NextAuth catch-all, proxy passthrough).
  3. `--passWithNoTests` PROHIBIDO en `package.json:scripts.test*`. Si un package no tiene tests todavía, primero declarar el config (vitest.config.ts) + agregar 1 test smoke; jamás dejar el flag activo (oculta gaps).
  4. `bypassRls=true` defense-in-depth: tests de este branch DEBEN ir en `test/integration/*.spec.ts` (Postgres real con NOBYPASSRLS aplicado). Mock unit con `mockDeep<PrismaClient>` NO valida la defensa real (BYPASSRLS role sin tenant ctx); solo prueba branch coverage del TS.
  5. Throttle e2e: NO desactivar global. `THROTTLE_LIMIT_DEFAULT=100` + `LOGIN_THROTTLE_LIMIT=50` para acomodar suites legítimas; specs que necesitan disable explícito (brute-force smoke) hacen override puntual antes de `bootstrapApp()`.
  6. Cross-tenant tests two-layer: layer-1 RLS (Postgres direct con `set local app.current_tenant=...`) cubre policies SELECT/INSERT/UPDATE/DELETE; layer-2 HTTP cubre RBAC + Fastify guards + service `withTenant()` paths. Ambos son COMPLEMENTARIOS, no redundantes.
  Estas 6 lecciones quedan en F9-report.md sección "Lecciones para DEVELOPER_GUIDE.md" para que F10 (consolidador) las integre en `docs/fixes/DEVELOPER_GUIDE.md`.

[F9] 2026-04-27 22:38 iter2 NEW-FINDING handoff F6→F9 — cuando F6 iter 2 ejecute la migración audit, los siguientes specs fallarán con shape change y deben actualizarse en el mismo PR (o F9 iter 3 lo hace post-merge):
  • `src/modules/auth/auth.service.spec.ts` — actualmente NO mockea `auditWriter.record`; post-F6 iter 2 al inyectarse `AuditContextFactory`, agregar mock con shape nueva (`action: 'otp_requested'/'otp_verified'`, `actorId/tenantId/ip/userAgent/traceId`).
  • `src/modules/insureds/insureds.service.spec.ts:344-347, 416-417` — cambiar `action: 'read'` → `action: 'read_viewed'`; `resourceType: 'insureds'` permanece (aplica a todas las acciones del recurso); shape `audit?.ip` ad-hoc sustituido por `AuditContext` POJO. Línea 505 (`action: 'export'`) permanece sin cambio (export sigue siendo enum existente).
  • `src/modules/certificates/certificates.service.spec.ts:87-92` — cambiar `action: 'read'` → `action: 'read_downloaded'`; payloadDiff `{ subAction: 'downloaded' }` deprecated (acción ya distingue). Eliminar mock `audit?.ip` ad-hoc; reemplazar por `expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actorId, tenantId, ip, userAgent, traceId }))`.

[F9] 2026-04-27 22:40 iter2 NEW-FINDING root .nvmrc ausente — no hay `.nvmrc` ni en SaaS root ni en segurasist-{api,web}. CI funciona porque `setup-node@v4` lee `node-version` del workflow env. Local dev relies on `engines.node` strict-engines (pnpm respeta) o nvm autoload sin .nvmrc. Recomendación opcional Sprint 5: agregar `.nvmrc` con `20.11` para alinear local dev (no bloqueante; F0 puede proponerlo en validation gate).

[F9] 2026-04-27 22:45 iter2 iter2-complete — F9 iter 2 verifica engine (DONE), defiere update specs a post-F6 (SKIPPED con handoff documentado), defiere ajuste threshold admin a post-F0 (SKIPPED por regla explícita), entrega 6 lecciones para DEVELOPER_GUIDE.md (DONE). Sin tests nuevos, sin source code modificado (per regla iter 2: solo configs + tests existentes). 2 NEW-FINDINGs nuevas: handoff F6→F9 + .nvmrc opcional. F9 iter 3 (si necesario) corre post-F6 iter 2 + post-F0 validation gate.
```
