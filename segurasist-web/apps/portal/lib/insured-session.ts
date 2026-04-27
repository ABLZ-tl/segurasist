import 'server-only';
import { cookies } from 'next/headers';
import { readFirstNameFromToken } from './jwt';
import { PORTAL_SESSION_COOKIE } from './cookie-names';

/**
 * Server-side helper that pulls the friendly first name out of the portal
 * session cookie so Server Components can render a personalised greeting
 * without re-decoding the JWT in every place.
 *
 * Returns `null` if the cookie is missing or the token has no usable name
 * claim — callers should render a generic fallback in that case.
 */
export function getInsuredFirstName(): string | null {
  const token = cookies().get(PORTAL_SESSION_COOKIE)?.value;
  if (!token) return null;
  return readFirstNameFromToken(token);
}
