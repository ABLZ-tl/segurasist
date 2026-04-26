/**
 * Origin allowlist enforcement (audit item M6).
 *
 * The admin SPA is a same-origin proxy: the browser only ever talks to its
 * own Next.js process, which then proxies to the backend API server-side.
 * Any state-changing HTTP method (POST/PUT/PATCH/DELETE) that arrives without
 * a matching `Origin` header is — by construction — a CSRF attempt or a
 * misconfigured caller. We reject both with 403.
 *
 * Webhooks are intentionally exempt because they are signed by an upstream
 * service (e.g. SES/Cognito), not driven by a browser. As of today no webhook
 * routes exist under `apps/admin/app/api/webhooks/*`, but the exemption is
 * encoded here so the rule is obvious to future contributors.
 */

const STATE_CHANGING_METHODS: ReadonlySet<string> = new Set([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

/** Webhook path prefixes whose handlers verify their own signatures. */
const WEBHOOK_PATH_PREFIXES: readonly string[] = ['/api/webhooks/'];

/**
 * Pull together the static allowlist plus any runtime-configured origin.
 * Lives in a function (not a module-level const) so tests can mutate
 * `process.env.NEXT_PUBLIC_ADMIN_ORIGIN` without re-importing the module.
 */
function getAllowedOrigins(): readonly string[] {
  const origins: string[] = ['http://localhost:3001'];
  const configured = process.env['NEXT_PUBLIC_ADMIN_ORIGIN'];
  if (configured && configured.length > 0 && !origins.includes(configured)) {
    origins.push(configured);
  }
  return origins;
}

export interface OriginCheckInput {
  method: string;
  pathname: string;
  origin: string | null;
}

export interface OriginCheckResult {
  /** Whether the request must be rejected. */
  reject: boolean;
  /** Reason string for logging/debugging — only set when `reject === true`. */
  reason?: 'missing-origin' | 'origin-not-allowed';
}

/**
 * Decide whether a request should be blocked by the Origin allowlist.
 *
 * Rules:
 *  - GET/HEAD/OPTIONS: never blocked (not state-changing in our model).
 *  - Webhook paths: never blocked (signed payloads, no browser involved).
 *  - Otherwise: require `Origin` header AND require it to match the allowlist.
 */
export function checkOrigin(input: OriginCheckInput): OriginCheckResult {
  const method = input.method.toUpperCase();
  if (!STATE_CHANGING_METHODS.has(method)) return { reject: false };

  if (WEBHOOK_PATH_PREFIXES.some((p) => input.pathname.startsWith(p))) {
    return { reject: false };
  }

  if (input.origin === null || input.origin.length === 0) {
    return { reject: true, reason: 'missing-origin' };
  }

  const allowed = getAllowedOrigins();
  if (!allowed.includes(input.origin)) {
    return { reject: true, reason: 'origin-not-allowed' };
  }
  return { reject: false };
}
