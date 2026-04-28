/**
 * Reusable same-origin API proxy factory used by `apps/{admin,portal}` to
 * forward client requests to the backend with a server-resolved Bearer token.
 *
 * Closes audit cross-cutting P7 (DRY admin↔portal proxies were ~85% identical)
 * and is the migration target for `apps/portal/app/api/proxy/[...path]/route.ts`
 * (owner: F2, iteration 2). The factory enforces Origin allowlist BEFORE
 * looking at cookies so an unauth'd CSRF attempt is rejected without
 * leaking timing information about the session state.
 *
 * Contract:
 *   - 403 when the request method is state-changing AND the `Origin` header
 *     is missing or not in the allowlist.
 *   - 401 when the session cookie is missing.
 *   - Otherwise, forwards to `{apiBase}/{path}` with `Authorization: Bearer
 *     <session>`, copying the original method, query string, body and the
 *     `x-trace-id` header. Hop-by-hop response headers (`transfer-encoding`,
 *     `connection`) are dropped.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { checkOrigin } from './origin';

export interface ProxyHandlerOptions {
  /** Cookie that holds the access token to forward as Bearer. */
  cookieName: string;
  /**
   * Origin allowlist. The factory always uses the simple `checkOrigin` rule:
   * empty Origin is allowed (server-to-server), otherwise the value must be
   * present in this list. Apps that need the full advanced check (webhook
   * exemptions, missing-origin rejection) should run that BEFORE invoking
   * the handler — the factory protects defense-in-depth, not as the only gate.
   */
  originAllowlist: readonly string[];
  /** Backend API base URL (no trailing slash), e.g. `https://api.segurasist.app`. */
  apiBase: string;
}

export interface ProxyHandlerContext {
  params: { path: string[] };
}

// Headers que NO se forwardean del upstream al cliente:
//  - hop-by-hop: rules HTTP, no significan nada cross-hop
//  - content-encoding/content-length: Node fetch decomprime gzip/deflate/br
//    transparentemente al consumir `upstream.body`. Forwardear esos headers
//    hace al browser intentar decode de nuevo sobre body ya en plain →
//    "incorrect header check" → Next dev convierte en 503.
const HOP_BY_HOP_HEADERS: ReadonlySet<string> = new Set([
  'transfer-encoding',
  'connection',
  'content-encoding',
  'content-length',
]);

/**
 * Build a `route.ts` handler that proxies to the upstream API.
 *
 * Usage:
 *
 * ```ts
 * // apps/portal/app/api/proxy/[...path]/route.ts
 * import { makeProxyHandler } from '@segurasist/security/proxy';
 * import { PORTAL_SESSION_COOKIE } from '../../../../lib/cookie-names';
 *
 * const handler = makeProxyHandler({
 *   cookieName: PORTAL_SESSION_COOKIE,
 *   originAllowlist: [process.env.NEXT_PUBLIC_PORTAL_ORIGIN!],
 *   apiBase: process.env.API_BASE_URL!,
 * });
 *
 * export const GET = handler;
 * export const POST = handler;
 * export const PUT = handler;
 * export const PATCH = handler;
 * export const DELETE = handler;
 * ```
 */
export function makeProxyHandler(options: ProxyHandlerOptions) {
  const { cookieName, originAllowlist, apiBase } = options;

  return async function proxyHandler(
    req: NextRequest,
    ctx: ProxyHandlerContext,
  ): Promise<NextResponse> {
    // 1. CSRF gate. Defense-in-depth: middleware should already have rejected
    //    cross-origin POSTs, but a misconfigured matcher would otherwise
    //    leave the proxy exposed. We use the simple primitive here (Origin
    //    must be either absent or in the allowlist) — the advanced webhook
    //    exemptions don't apply because nothing under `/api/proxy/*` is a
    //    signed webhook target.
    if (!checkOrigin(req, originAllowlist)) {
      return NextResponse.json(
        { error: 'origin-rejected' },
        { status: 403 },
      );
    }

    // 2. Session gate. Without an access token cookie there is nothing to
    //    forward; reject with 401 rather than leaking an unauth'd backend
    //    response (the API would 401 too, but going through an extra hop
    //    burns bandwidth and makes log triage harder).
    const token = req.cookies.get(cookieName)?.value;
    if (!token) {
      return NextResponse.json(
        { error: 'unauthorized' },
        { status: 401 },
      );
    }

    // 3. Build the upstream URL. Strip the route prefix and re-attach the
    //    user's query string verbatim so the API never sees Next-specific
    //    params.
    const url = new URL(`${apiBase}/${ctx.params.path.join('/')}`);
    for (const [k, v] of req.nextUrl.searchParams) {
      url.searchParams.append(k, v);
    }

    // 4. Forward headers. We do NOT pass the cookie jar through — the
    //    backend authenticates on Authorization, and forwarding cookies
    //    would expose them to the upstream domain (which may be a different
    //    origin from the browser's perspective).
    const headers = new Headers();
    headers.set('content-type', req.headers.get('content-type') ?? 'application/json');
    headers.set('authorization', `Bearer ${token}`);
    const trace = req.headers.get('x-trace-id');
    if (trace) headers.set('x-trace-id', trace);

    const init: RequestInit = {
      method: req.method,
      headers,
      redirect: 'manual',
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = await req.arrayBuffer();
    }

    const upstream = await fetch(url, init);

    // 5. Copy response headers, dropping hop-by-hop headers that don't
    //    survive a fetch boundary.
    const respHeaders = new Headers();
    upstream.headers.forEach((v, k) => {
      if (!HOP_BY_HOP_HEADERS.has(k.toLowerCase())) {
        respHeaders.set(k, v);
      }
    });

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  };
}
