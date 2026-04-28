/**
 * Same-origin API proxy del portal asegurado.
 *
 * Sprint 4 — F2 iter 2 (B-PORTAL-AUTH): migrado a `makeProxyHandler` factory
 * de `@segurasist/security/proxy`, eliminando la duplicación con admin que
 * causó los hallazgos C-02 (cookie-name drift) y H-04 (origin gate olvidado).
 * El factory aplica:
 *   - 403 si Origin presente y no está en `originAllowlist` (CSRF gate).
 *   - 401 si la cookie de sesión no existe.
 *   - Forward a `{API_BASE_URL}/{path}` con `Authorization: Bearer <cookie>`,
 *     copiando query string y propagando `x-trace-id`. Hop-by-hop response
 *     headers (`transfer-encoding`, `connection`) se descartan.
 *
 * Histórico — fixes iter 1 cerrados (ahora encapsulados en el factory):
 *   - C-02: el portal lee `sa_session_portal` (no `sa_session` del admin).
 *   - H-04: defense-in-depth Origin allowlist también a nivel handler.
 *
 * NOTA: el factory usa `checkOrigin` simple (Origin ausente = allowed). El
 * gate avanzado con webhook exemptions vive en `apps/portal/middleware.ts`
 * vía `lib/origin-allowlist.ts`. Aquí no aplica porque `/api/proxy/*` jamás
 * recibe payloads firmados.
 */
import { makeProxyHandler } from '@segurasist/security/proxy';
import { PORTAL_SESSION_COOKIE } from '@/lib/cookie-names';

const handler = makeProxyHandler({
  cookieName: PORTAL_SESSION_COOKIE,
  originAllowlist: [process.env['NEXT_PUBLIC_PORTAL_ORIGIN'] ?? 'http://localhost:3002'],
  apiBase: process.env['API_BASE_URL'] ?? 'https://api.segurasist.app',
});

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
