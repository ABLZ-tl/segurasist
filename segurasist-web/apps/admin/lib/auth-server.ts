import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@segurasist/auth';
import { isRole, type Role } from './rbac';

const API_BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3000';

/** Shape returned by `GET /v1/auth/me`. We only consume what the UI needs. */
interface MeResponse {
  id?: string;
  email?: string;
  role?: string;
  mfa?: boolean;
  tenant?: { id?: string };
  // Legacy/loose fallbacks observed in earlier versions of the API.
  user?: { email?: string; role?: string };
  data?: { email?: string; role?: string };
}

export interface Me {
  email: string | null;
  role: Role | null;
  tenantId: string | null;
}

/**
 * Server-only fetch of the authenticated user. Returns nullable fields on any
 * failure so consumers (layout, dashboard, gated pages) can degrade
 * gracefully if `/v1/auth/me` is unreachable.
 *
 * Reuses the `sa_session` cookie value as a Bearer token. The same idToken
 * is also forwarded under `Cookie: session=...` for backends that read it
 * either way.
 */
export async function fetchMe(): Promise<Me> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return { email: null, role: null, tenantId: null };
  try {
    const res = await fetch(`${API_BASE}/v1/auth/me`, {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        cookie: `session=${token}`,
      },
      cache: 'no-store',
    });
    if (!res.ok) return { email: null, role: null, tenantId: null };
    const body = (await res.json()) as MeResponse;
    const email =
      body.email ?? body.user?.email ?? body.data?.email ?? null;
    const rawRole = body.role ?? body.user?.role ?? body.data?.role ?? null;
    const role = isRole(rawRole) ? rawRole : null;
    const tenantId = body.tenant?.id ?? null;
    return {
      email: typeof email === 'string' ? email : null,
      role,
      tenantId: typeof tenantId === 'string' ? tenantId : null,
    };
  } catch {
    return { email: null, role: null, tenantId: null };
  }
}
