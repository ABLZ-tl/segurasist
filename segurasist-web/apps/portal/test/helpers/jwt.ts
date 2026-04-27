/**
 * Build deterministic JWT-shaped strings for unit tests. The middleware only
 * decodes the payload (signature is never verified), so the header and
 * signature segments are placeholders.
 */

function base64url(input: string): string {
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function makeJwt(payload: Record<string, unknown>): string {
  const header = base64url('{"alg":"none","typ":"JWT"}');
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

/** Helper for the most common case: an insured token that is not expired. */
export function makeInsuredJwt(extra: Record<string, unknown> = {}): string {
  return makeJwt({
    sub: 'insured-uuid',
    'custom:role': 'insured',
    'custom:insured_id': 'insured-uuid',
    given_name: 'María',
    email: 'maria@example.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...extra,
  });
}
