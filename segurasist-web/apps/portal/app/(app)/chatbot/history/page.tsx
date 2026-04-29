/**
 * Sprint 5 — S5-3 finisher.
 *
 * Server Component shell del histórico de conversaciones del chatbot
 * (portal del asegurado).
 *
 * RBAC:
 *   El portal sólo gatea presencia de cookie de sesión (lo hace el
 *   middleware más arriba). Los endpoints `/v1/chatbot/conversations` ya
 *   están restringidos a `Roles('insured')` en el BE; si llega a esta
 *   ruta un usuario sin sesión, react-query verá 401 y redirige a /login
 *   vía la política global del provider.
 *
 * El histórico vive en un Client Component (`history-client.tsx`) por uso de
 * react-query + GSAP/Lordicon. Aquí solo renderizamos el shell.
 */

import { HistoryClient } from './history-client';

export const dynamic = 'force-dynamic';

export default function ChatbotHistoryPage(): JSX.Element {
  return <HistoryClient />;
}
