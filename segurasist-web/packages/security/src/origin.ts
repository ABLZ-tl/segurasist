/**
 * Consolidated Origin allowlist enforcement (audit M6 + H-04 + H-07).
 *
 * Both admin and portal apps are same-origin proxies: the browser only ever
 * talks to its own Next.js process, which then proxies to the backend API
 * server-side. Any state-changing HTTP method (POST/PUT/PATCH/DELETE) that
 * arrives without a matching `Origin` header is — by construction — a CSRF
 * attempt or a misconfigured caller. We reject both with 403.
 *
 * Webhooks are intentionally exempt because they are signed by an upstream
 * service (e.g. SES/Cognito), not driven by a browser. As of today no webhook
 * routes exist under `apps/{admin,portal}/app/api/webhooks/*`, but the
 * exemption is encoded here so the rule is obvious to future contributors.
 *
 * Two APIs:
 *   - {@link checkOrigin} — simple primitive used by `proxy.ts` and any
 *     handler that already knows the request is state-changing. Returns
 *     `true` when the request is allowed (origin missing OR in allowlist),
 *     `false` when it must be rejected.
 *   - {@link checkOriginAdvanced} — full decision tree used by the per-app
 *     middleware: checks method, webhook prefixes and produces a structured
 *     `{ reject, reason }` result for logging.
 */

const STATE_CHANGING_METHODS: ReadonlySet<string> = new Set([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

/** Default webhook path prefixes whose handlers verify their own signatures. */
export const DEFAULT_WEBHOOK_PATH_PREFIXES: readonly string[] = ['/api/webhooks/'];

/**
 * Simple primitive: is this request's `Origin` acceptable?
 *
 *  - Returns `true` when the `Origin` header is absent (server-to-server,
 *    CLI tooling, native clients) — the caller is responsible for rejecting
 *    those at a higher layer if their threat model requires it.
 *  - Returns `true` when the `Origin` matches one of the allowed entries.
 *  - Returns `false` otherwise.
 */
export function checkOrigin(req: Request, allowlist: readonly string[]): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  return allowlist.includes(origin);
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

export interface AdvancedOriginOptions {
  /** Static base origins always allowed (e.g. localhost dev origin). */
  allowedOrigins: readonly string[];
  /** Optional runtime-configured origin (typically from env at call time). */
  configuredOrigin?: string | null | undefined;
  /** Override the webhook prefixes (defaults to `/api/webhooks/`). */
  webhookPathPrefixes?: readonly string[];
}

/**
 * Decide whether a request should be blocked by the Origin allowlist.
 *
 * Rules:
 *  - GET/HEAD/OPTIONS: never blocked (not state-changing in our model).
 *  - Webhook paths: never blocked (signed payloads, no browser involved).
 *  - Otherwise: require `Origin` header AND require it to match the allowlist.
 */
export function checkOriginAdvanced(
  input: OriginCheckInput,
  options: AdvancedOriginOptions,
): OriginCheckResult {
  const method = input.method.toUpperCase();
  if (!STATE_CHANGING_METHODS.has(method)) return { reject: false };

  const webhookPrefixes = options.webhookPathPrefixes ?? DEFAULT_WEBHOOK_PATH_PREFIXES;
  if (webhookPrefixes.some((p) => input.pathname.startsWith(p))) {
    return { reject: false };
  }

  if (input.origin === null || input.origin.length === 0) {
    return { reject: true, reason: 'missing-origin' };
  }

  const allowed = mergeAllowlist(options.allowedOrigins, options.configuredOrigin ?? null);
  if (!allowed.includes(input.origin)) {
    return { reject: true, reason: 'origin-not-allowed' };
  }
  return { reject: false };
}

/**
 * Build the full allowlist by merging the static base origins with an optional
 * runtime-configured origin. Exposed so each app can compose its own
 * `checkOrigin({ method, pathname, origin })` wrapper that reads its env var
 * lazily (apps need this to keep tests isolated; see `apps/admin/lib/origin-allowlist.ts`).
 */
export function mergeAllowlist(
  base: readonly string[],
  configured: string | null | undefined,
): readonly string[] {
  if (!configured || configured.length === 0) return base;
  if (base.includes(configured)) return base;
  return [...base, configured];
}
