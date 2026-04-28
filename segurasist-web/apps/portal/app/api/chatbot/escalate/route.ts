/**
 * S4-08 — Endpoint específico del escalamiento del chatbot.
 *
 * POST `/api/chatbot/escalate` → `${API_BASE_URL}/v1/chatbot/escalate`.
 *
 * Mismo razonamiento que `app/api/chatbot/route.ts`: ruta estática que
 * reusa la factory `makeProxyHandler` para CSRF gate + Bearer forward + trace
 * id propagation. La razón para tenerlo dedicado en lugar de pasar por el
 * catchall es que el escalamiento crea ticket + envía correos (efecto
 * lateral observable), por lo que querremos en iter 2 agregar:
 *   - Métricas EMF dedicadas: `ChatbotEscalationsCreated{success|failed}`.
 *   - Throttle más estricto que el global (un asegurado no debería poder
 *     emitir 100 tickets/min).
 *
 * Hoy ambas optimizaciones son trabajo del backend (S6 dueño de la lógica),
 * pero al tener el endpoint dedicado abrimos el espacio sin tocar el
 * catchall.
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

export async function POST(req: NextRequest): Promise<Response> {
  return proxy(req, { params: { path: ['v1', 'chatbot', 'escalate'] } });
}
