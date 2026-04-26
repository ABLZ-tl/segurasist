import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@segurasist/auth';

/**
 * Same proxy semantics as the admin app — see admin/app/api/proxy/[...path]
 * for the full doc. Intentionally duplicated so each app can deploy
 * independently without sharing a runtime.
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

  const init: RequestInit = { method: req.method, headers, redirect: 'manual' };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer();
  }

  const upstream = await fetch(url, init);
  const respHeaders = new Headers();
  upstream.headers.forEach((v, k) => {
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
