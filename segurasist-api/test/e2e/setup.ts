/**
 * Setup global de los e2e — corre antes de cada spec via `setupFiles` en
 * `jest.config.ts` (proyecto `e2e`).
 *
 * Responsabilidades:
 *  1. Forzar issuer Cognito a `http://0.0.0.0:9229` (cognito-local). Cada
 *     spec ya lo setea individualmente, pero centralizarlo evita drift.
 *  2. Deshabilitar rate limiter (`THROTTLE_ENABLED=false`). Los e2e
 *     comparten Redis y hacen muchos logins legítimos por suite; sin esto
 *     el `@Throttle({limit:5})` de auth/login bloquea entre suites.
 *     El integration spec del throttler usa un módulo aislado in-memory y
 *     NO está afectado por esta variable (no la lee).
 */

process.env.COGNITO_ENDPOINT ??= 'http://0.0.0.0:9229';
process.env.THROTTLE_ENABLED = 'false';
