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

/**
 * Simple Cognito Hosted UI route. Routes:
 *   GET  /api/auth/login?provider=MAC-SAML  → redirect to Cognito
 *   GET  /api/auth/callback                  → exchange code, set cookies
 *   POST /api/auth/logout                    → clear cookies + redirect
 *
 * Note: this is a deliberate stub. In production we may switch to
 * `next-auth` v5 with the Cognito provider. The signature is kept so
 * existing routes (`signIn`, `signOut`) keep working.
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
    res.cookies.set(PKCE_COOKIE, verifier, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });
    res.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
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

  if (action === 'logout') {
    const res = NextResponse.redirect(buildLogoutUrl());
    clearSessionCookies(res);
    return res;
  }

  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export const POST = GET;
