import { NextResponse, type NextRequest } from 'next/server';
import {
  PKCE_COOKIE,
  STATE_COOKIE,
  buildAuthorizeUrl,
  buildLogoutUrl,
  exchangeCodeForTokens,
  generatePkcePair,
} from '@segurasist/auth';
import { clearSessionCookies, setSessionCookies } from '@segurasist/auth/session';
import { checkOrigin } from '../../../../lib/origin-allowlist';

/**
 * Cognito Hosted UI route. Routes:
 *   GET  /api/auth/login?provider=MAC-SAML  → redirect to Cognito
 *   GET  /api/auth/callback                  → exchange code, set cookies
 *   POST /api/auth/logout                    → clear cookies + redirect to Cognito /logout
 *
 * Sprint 4 / B-COOKIES-DRY:
 *   - C-11 + H-06: session cookies are written via `@segurasist/auth/session`,
 *     which now delegates to `@segurasist/security/cookie` and so produces
 *     `SameSite=Strict` cookies on the Cognito callback.
 *   - H-07: logout MUST be POST + Origin-allowlisted. The previous handler
 *     accepted GET (and aliased `POST = GET`) which let any cross-site image
 *     tag (`<img src="https://admin/api/auth/logout">`) destroy a logged-in
 *     user's session. We now reject logout via GET with 405 and require a
 *     same-origin POST.
 *
 * Note: this is a deliberate stub. In production we may switch to
 * `next-auth` v5 with the Cognito provider. The exposed surface is GET for
 * `login`/`callback`, POST for `logout`.
 */

function randomState(): string {
  const buf = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function GET(req: NextRequest, { params }: { params: { nextauth: string[] } }) {
  const action = params.nextauth[0];

  if (action === 'login') {
    const provider = req.nextUrl.searchParams.get('provider') ?? undefined;
    const { verifier, challenge } = await generatePkcePair();
    const state = randomState();
    const url = buildAuthorizeUrl({
      state,
      codeChallenge: challenge,
      ...(provider ? { identityProvider: provider } : {}),
    });
    const res = NextResponse.redirect(url);
    // PKCE/state are short-lived helpers, not session-bearing — they still
    // get strict to keep the surface uniform.
    res.cookies.set(PKCE_COOKIE, verifier, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 600,
      path: '/',
    });
    res.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 600,
      path: '/',
    });
    return res;
  }

  if (action === 'callback') {
    const code = req.nextUrl.searchParams.get('code');
    const state = req.nextUrl.searchParams.get('state');
    const expectedState = req.cookies.get(STATE_COOKIE)?.value;
    const verifier = req.cookies.get(PKCE_COOKIE)?.value;
    if (!code || !state || state !== expectedState || !verifier) {
      return NextResponse.redirect(new URL('/login?error=state', req.url));
    }
    try {
      const tokens = await exchangeCodeForTokens(code, verifier);
      const res = NextResponse.redirect(new URL('/dashboard', req.url));
      setSessionCookies(res, tokens);
      res.cookies.delete(PKCE_COOKIE);
      res.cookies.delete(STATE_COOKIE);
      return res;
    } catch {
      return NextResponse.redirect(new URL('/login?error=oauth', req.url));
    }
  }

  // H-07: logout cannot be served via GET. Force the client to POST so that
  //  - browsers won't follow `<img>` / `<link rel=prefetch>` / cross-site
  //    navigation tags into a session-destroying call,
  //  - the SameSite=Strict cookie can't be exfiltrated by a top-level GET.
  if (action === 'logout') {
    return NextResponse.json({ error: 'method-not-allowed' }, { status: 405 });
  }

  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function POST(req: NextRequest, { params }: { params: { nextauth: string[] } }) {
  const action = params.nextauth[0];

  if (action === 'logout') {
    // H-07 defense-in-depth: even though `middleware.ts` already enforces
    // Origin on every state-changing request, we re-check here so the
    // logout surface stays correct if the matcher is ever misconfigured.
    const result = checkOrigin({
      method: req.method,
      pathname: req.nextUrl.pathname,
      origin: req.headers.get('origin'),
    });
    if (result.reject) {
      return NextResponse.json(
        { error: 'origin-rejected', reason: result.reason },
        { status: 403 },
      );
    }

    const res = NextResponse.redirect(buildLogoutUrl());
    clearSessionCookies(res);
    return res;
  }

  return NextResponse.json({ error: 'method-not-allowed' }, { status: 405 });
}
