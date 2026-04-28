/**
 * S4-05 — Endpoint específico del chatbot del portal asegurado.
 *
 * Este handler reenvía POST `/api/chatbot` a `${API_BASE_URL}/v1/chatbot/message`
 * usando la misma factory `makeProxyHandler` de `@segurasist/security/proxy`
 * que el proxy genérico (ver `app/api/proxy/[...path]/route.ts`). Sale
 * adelantado al catchall porque Next.js prioriza rutas específicas sobre
 * dinámicas, lo cual nos da:
 *
 *   1. Superficie pública mínima del chatbot (solo POST, no GET/PATCH/etc.).
 *   2. Punto único de instrumentación si en iter 2 queremos custom metrics
 *      (latencia p95 chatbot, tasa de fallback) sin contaminar el catchall.
 *   3. Defensa-en-profundidad: aún si por error eliminan el catchall, el
 *      chatbot sigue funcionando.
 *
 * NOTA: El cliente `@segurasist/api-client` actualmente apunta a
 * `/api/proxy/v1/chatbot/message` (catchall). Ambos caminos llegan al mismo
 * upstream — este endpoint dedicado existe por contrato del Sprint 4 dispatch
 * y como super-set defensivo. Si en iter 2 migramos los hooks a
 * `/api/chatbot` directo, este handler ya está listo (mismo factory, mismo
 * security profile).
 *
 * Seguridad (heredada del factory):
 *   - 403 si Origin presente y no en allowlist (CSRF gate).
 *   - 401 si no hay cookie de sesión.
 *   - Forward `Authorization: Bearer <cookie>` server-side; nunca expone token
 *     al browser.
 *   - Propaga `x-trace-id` para correlación con backend OpenTelemetry.
 */
import type { NextRequest } from 'next/server';
import { makeProxyHandler } from '@segurasist/security/proxy';
import { PORTAL_SESSION_COOKIE } from '@/lib/cookie-names';

const proxy = makeProxyHandler({
  cookieName: PORTAL_SESSION_COOKIE,
  originAllowlist: [
    process.env['NEXT_PUBLIC_PORTAL_ORIGIN'] ?? 'http://localhost:3002',
  ],
  apiBase: process.env['API_BASE_URL'] ?? 'https://api.segurasist.app',
});

/**
 * `makeProxyHandler` recibe un context tipado `{ params: { path: string[] } }`
 * (firma del catchall). Para rutas estáticas como esta, simulamos el path
 * exactamente como lo emitiría el catchall: `['v1','chatbot','message']`.
 * Mantener la misma factory garantiza que cualquier hardening futuro
 * (audit log proxy, rate limit) se aplique uniforme.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return proxy(req, { params: { path: ['v1', 'chatbot', 'message'] } });
}
