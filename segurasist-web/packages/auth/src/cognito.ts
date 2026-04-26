import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { getAuthEnv } from './config';

/**
 * Cognito helpers for the admin OAuth Authorization Code Flow with PKCE.
 *
 * Flow summary (admin):
 *   1. /login → buildAuthorizeUrl() → 302 to Cognito Hosted UI (SAML/OIDC).
 *   2. Cognito → /api/auth/callback?code=...&state=...
 *   3. exchangeCodeForTokens(code, codeVerifier) → access/id/refresh tokens.
 *   4. Set HttpOnly Secure SameSite=Lax cookies (see session.ts).
 *
 * Flow summary (portal asegurado):
 *   1. /login posts CURP+channel → backend creates CUSTOM_CHALLENGE session.
 *   2. /otp posts code → backend completes challenge, returns tokens.
 *   3. Frontend never touches Cognito SDK directly; backend issues a session.
 *
 * NOTE: This file deliberately avoids the AWS SDK to keep the bundle small;
 * Hosted UI is plain HTTPS. Replace with @aws-amplify/auth if you need
 * federated identities or device tracking.
 */

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (cachedJwks) return cachedJwks;
  const { region, userPoolId } = getAuthEnv();
  const jwksUrl = new URL(
    `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`,
  );
  // jose caches the keys in-memory by default.
  cachedJwks = createRemoteJWKSet(jwksUrl);
  return cachedJwks;
}

export interface VerifiedToken {
  payload: JWTPayload & {
    'cognito:username'?: string;
    'cognito:groups'?: string[];
    email?: string;
    sub: string;
  };
}

export async function verifyAccessToken(token: string): Promise<VerifiedToken> {
  const { region, userPoolId, clientId } = getAuthEnv();
  const jwks = getJwks();
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
    // Cognito access tokens use `client_id`; ID tokens use `aud`. We accept either.
  });
  if (payload['client_id'] && payload['client_id'] !== clientId) {
    throw new Error('Invalid token client_id');
  }
  return { payload: payload as VerifiedToken['payload'] };
}

export interface CognitoTokens {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: 'Bearer';
}

/** Build the Hosted UI authorize URL with PKCE. */
export function buildAuthorizeUrl(params: {
  state: string;
  codeChallenge: string;
  identityProvider?: string; // e.g. "MAC-SAML"
}): string {
  const env = getAuthEnv();
  const url = new URL(`${env.domain}/oauth2/authorize`);
  url.searchParams.set('client_id', env.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', env.redirectUri);
  url.searchParams.set('scope', env.scope);
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (params.identityProvider) {
    url.searchParams.set('identity_provider', params.identityProvider);
  }
  return url.toString();
}

/** Exchange auth code for tokens. Server-side only. */
export async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<CognitoTokens> {
  const env = getAuthEnv();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: env.clientId,
    code,
    redirect_uri: env.redirectUri,
    code_verifier: codeVerifier,
  });
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (env.clientSecret) {
    headers['authorization'] = `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString('base64')}`;
  }
  const res = await fetch(`${env.domain}/oauth2/token`, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`Cognito token exchange failed: ${res.status}`);
  return (await res.json()) as CognitoTokens;
}

export async function refreshTokens(refreshToken: string): Promise<CognitoTokens> {
  const env = getAuthEnv();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: env.clientId,
    refresh_token: refreshToken,
  });
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (env.clientSecret) {
    headers['authorization'] = `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString('base64')}`;
  }
  const res = await fetch(`${env.domain}/oauth2/token`, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`Cognito refresh failed: ${res.status}`);
  return (await res.json()) as CognitoTokens;
}

export function buildLogoutUrl(): string {
  const env = getAuthEnv();
  const url = new URL(`${env.domain}/logout`);
  url.searchParams.set('client_id', env.clientId);
  url.searchParams.set('logout_uri', env.logoutUri);
  return url.toString();
}

/** PKCE helpers (Web Crypto). */
export async function generatePkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge };
}

function base64UrlEncode(buf: Uint8Array): string {
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
