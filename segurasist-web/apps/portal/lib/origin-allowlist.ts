/**
 * Portal Origin allowlist. Sprint 4 / B-COOKIES-DRY (audit H-19): the rule
 * engine lives in `@segurasist/security/origin` so admin and portal share
 * one source of truth. This wrapper applies portal-specific configuration:
 *
 *   - dev fallback origin `http://localhost:3002`,
 *   - runtime override `NEXT_PUBLIC_PORTAL_ORIGIN`.
 *
 * The runtime override is read INSIDE `checkOrigin` so unit tests can mutate
 * `process.env` without re-importing the module (matches the previous
 * behavior; not a regression).
 */
import {
  checkOriginAdvanced,
  type OriginCheckInput,
  type OriginCheckResult,
} from '@segurasist/security/origin';

const STATIC_ORIGINS: readonly string[] = ['http://localhost:3002'];

export type { OriginCheckInput, OriginCheckResult };

/**
 * Decide whether a request should be blocked by the Origin allowlist.
 *
 * Rules (delegated to `@segurasist/security/origin`):
 *  - GET/HEAD/OPTIONS: never blocked.
 *  - Webhook prefixes (`/api/webhooks/`): never blocked.
 *  - State-changing methods: require Origin header in the merged allowlist.
 */
export function checkOrigin(input: OriginCheckInput): OriginCheckResult {
  return checkOriginAdvanced(input, {
    allowedOrigins: STATIC_ORIGINS,
    configuredOrigin: process.env['NEXT_PUBLIC_PORTAL_ORIGIN'] ?? null,
  });
}
