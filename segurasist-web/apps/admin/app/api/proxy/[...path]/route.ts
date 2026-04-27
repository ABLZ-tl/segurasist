import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@segurasist/auth';

/**
 * Server-to-server reverse proxy to the SegurAsist API.
 *
 * - Reads the access token from the HttpOnly cookie (`SESSION_COOKIE`) and
 *   injects it as `Authorization: Bearer ...` on the upstream request.
 * - Forwards `x-trace-id` for distributed tracing.
 * - Streams the upstream response back as-is (status, body, headers).
 *
 * The browser never sees the access token, satisfying the "no tokens in
 * localStorage / no Bearer in JS" rule.
 */

const API_BASE = process.env['API_BASE_URL'] ?? 'https://api.segurasist.app';

async function handle(req: NextRequest, path: string[]) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const url = new URL(`${API_BASE}/${path.join('/')}`);
  for (const [k, v] of req.nextUrl.searchParams) url.searchParams.append(k, v);

  const headers = new Headers();
  headers.set('content-type', req.headers.get('content-type') ?? 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const trace = req.headers.get('x-trace-id');
  if (trace) headers.set('x-trace-id', trace);
  // S3-08 — Forward X-Tenant-Override from client (Zustand store) to upstream.
  // Solo `admin_segurasist` puede usar este header con éxito; el backend
  // (JwtAuthGuard) rechaza con 403 cualquier otro rol que lo envíe. El proxy
  // se limita a forwardear (defense in depth: validación del rol vive en el
  // backend, no acá).
  const overrideTenant = req.headers.get('x-tenant-override');
  if (overrideTenant) headers.set('x-tenant-override', overrideTenant);

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: 'manual',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer();
  }

  const upstream = await fetch(url, init);
  const respHeaders = new Headers();
  upstream.headers.forEach((v, k) => {
    // Strip hop-by-hop headers; let Next set its own.
    if (!['transfer-encoding', 'connection'].includes(k.toLowerCase())) {
      respHeaders.set(k, v);
    }
  });
  return new NextResponse(upstream.body, { status: upstream.status, headers: respHeaders });
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return handle(req, params.path);
}
export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
