/**
 * Nombres de las cookies del portal asegurado. Centralizadas aquí (lib/)
 * porque Next.js 14 prohíbe exports custom desde `middleware.ts` y desde
 * `app/**\/route.ts` (solo permite handlers GET/POST/PUT/PATCH/DELETE +
 * dynamic/revalidate flags). Importar desde aquí en lugar de re-exportar
 * de middleware o de route handlers.
 */
export const PORTAL_SESSION_COOKIE = 'sa_session_portal';
export const PORTAL_REFRESH_COOKIE = 'sa_refresh_portal';
