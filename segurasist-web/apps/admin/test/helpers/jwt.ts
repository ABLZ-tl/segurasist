/**
 * Build deterministic JWT-shaped strings for unit tests. The middleware only
 * decodes the payload (signature is never verified — see `lib/jwt.ts`), so
 * the header and signature segments are placeholders.
 */

function base64url(input: string): string {
  // jsdom + Node both expose Buffer; use it for stable output.
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

/** Build a JWT whose payload segment is invalid base64url JSON. */
export function makeBrokenPayloadJwt(): string {
  return 'header.@@@notb64@@@.sig';
}

/** Build a JWT whose payload decodes to a non-object (an array). */
export function makeArrayPayloadJwt(): string {
  const header = base64url('{"alg":"none"}');
  const body = base64url('[1,2,3]');
  return `${header}.${body}.sig`;
}

/** Build a JWT whose payload decodes to non-JSON. */
export function makeNonJsonPayloadJwt(): string {
  const header = base64url('{"alg":"none"}');
  const body = base64url('not json at all');
  return `${header}.${body}.sig`;
}
