/**
 * Setup global de los e2e — corre antes de cada spec via `setupFiles` en
 * `jest.config.ts` (proyecto `e2e`).
 *
 * Responsabilidades:
 *  1. Forzar issuer Cognito a `http://0.0.0.0:9229` (cognito-local). Cada
 *     spec ya lo setea individualmente, pero centralizarlo evita drift.
 *  2. Configurar rate limiter en modo "estricto pero permisivo" — H-26
 *     (Sprint 4): antes este setup mascaraba A4-25 + A6-46 (endpoints sin
 *     `@Throttle`) porque combinaba `THROTTLE_LIMIT_DEFAULT=10000` con
 *     `THROTTLE_ENABLED=false`. Cualquier endpoint que faltara declarar
 *     un `@Throttle` "pasaba" los e2e. Ahora:
 *       - mantenemos el throttler habilitado (`THROTTLE_ENABLED=true`),
 *       - bajamos el default a 100 req/min — suficiente para correr la
 *         suite (login + healthcheck + listados) pero capaz de detectar
 *         loops 1000+ req del bug-pattern A4-25,
 *       - los specs que necesitan loops mayores (p.ej. brute-force smoke)
 *         declaran su propio `process.env.THROTTLE_ENABLED='false'` ANTES
 *         del `bootstrapApp()` (override puntual y explícito).
 *     Específicamente para los flujos de login (5 req/min hard-coded en
 *     `@Throttle({limit:5})`), seteamos `LOGIN_THROTTLE_LIMIT` a 50 para
 *     que los suites concurrentes no se pisen entre sí.
 */

process.env.COGNITO_ENDPOINT ??= 'http://0.0.0.0:9229';
// H-26 — throttle real, no modo flagging. Los specs que necesitan saltarlo
// hacen un override explícito antes de `bootstrapApp()`.
process.env.THROTTLE_ENABLED ??= 'true';
process.env.THROTTLE_LIMIT_DEFAULT ??= '100';
process.env.THROTTLE_TTL_MS ??= '60000';
// Login pre-existente declara `@Throttle({limit:5})`; algunos suites tienen
// múltiples logins legítimos. Ampliamos a 50 con la misma TTL para no
// romper specs que iteren admin_mac + admin_segurasist + insureds.
process.env.LOGIN_THROTTLE_LIMIT ??= '50';
