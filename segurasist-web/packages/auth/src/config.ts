/**
 * Centralized auth env config. All values are server-side only.
 * Never import this from a Client Component.
 */
export interface AuthEnv {
  region: string;
  userPoolId: string;
  clientId: string;
  clientSecret?: string;
  domain: string; // e.g. https://segurasist.auth.mx-central-1.amazoncognito.com
  redirectUri: string; // e.g. https://admin.segurasist.app/api/auth/callback
  logoutUri: string;
  scope: string;
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function getAuthEnv(): AuthEnv {
  return {
    region: required('COGNITO_REGION', process.env['COGNITO_REGION']),
    userPoolId: required('COGNITO_USER_POOL_ID', process.env['COGNITO_USER_POOL_ID']),
    clientId: required('COGNITO_CLIENT_ID', process.env['COGNITO_CLIENT_ID']),
    ...(process.env['COGNITO_CLIENT_SECRET']
      ? { clientSecret: process.env['COGNITO_CLIENT_SECRET'] }
      : {}),
    domain: required('COGNITO_DOMAIN', process.env['COGNITO_DOMAIN']),
    redirectUri: required('COGNITO_REDIRECT_URI', process.env['COGNITO_REDIRECT_URI']),
    logoutUri: process.env['COGNITO_LOGOUT_URI'] ?? process.env['COGNITO_REDIRECT_URI']!,
    scope: process.env['COGNITO_SCOPE'] ?? 'openid email profile',
  };
}

export const SESSION_COOKIE = 'sa_session';
export const REFRESH_COOKIE = 'sa_refresh';
export const PKCE_COOKIE = 'sa_pkce';
export const STATE_COOKIE = 'sa_state';
