/**
 * S4-05 / S4-08 — Hooks del chatbot del portal asegurado.
 *
 * Bundle owner: S4 (frontend) + coordinación con S5 (NLP/KB) y S6
 * (personalización + escalation). Iter 2: tipos alineados al shape final
 * publicado por S5 (`ChatMessageResponse` en `dto/chat-message.dto.ts`)
 * y S6 (`EscalateResult` en `dto/escalation.dto.ts`).
 *
 *   POST /v1/chatbot/message  { message, conversationId? }
 *     → { conversationId, response, matched, category?, escalated }
 *
 *   POST /v1/chatbot/escalate { conversationId, reason? }
 *     → { conversationId, alreadyEscalated, emailSentToMac, acknowledgementSentToInsured }
 *
 *   ⚠ Iter 2 — el endpoint `/v1/chatbot/escalate` aún NO está expuesto en
 *   `chatbot.controller.ts` (solo `POST /v1/chatbot/message`). El flow
 *   de no-match ya delega a `EscalationService.escalate` desde
 *   `KbService.processMessage`, devolviendo `escalated: true` en la misma
 *   respuesta. Hasta que S5/S6 publiquen el `@Post('escalate')`, este
 *   hook puede invocarse pero el backend devolverá 404. NEEDS-COORDINATION
 *   → ver feed S4-iter2.md NEW-FINDING.
 *
 * Notas:
 *  - Usamos el wrapper `api()` de `client.ts`, que enruta por
 *    `/api/proxy/*` y agrega `x-trace-id`. NUNCA llamar al backend
 *    directo desde el browser (token HttpOnly viene del proxy).
 *  - La mutation `useSendChatMessage` no invalida queries — el chatbot
 *    mantiene su propio estado local en el widget (zustand-like
 *    reducer). Si en el futuro persistimos historial server-side,
 *    agregamos `chatbotKeys.history(conversationId)` y el invalidate.
 *  - Routes dedicated vs catchall (decisión orquestador iter 2):
 *    mantenemos AMBAS — `/api/proxy/v1/chatbot/*` (catchall) consumido por
 *    los hooks + `/api/chatbot` y `/api/chatbot/escalate` (dedicated)
 *    reusando `makeProxyHandler`. No afecta runtime; se reevalúa Sprint 5.
 */
import { useMutation } from '@tanstack/react-query';
import { api } from '../client';

export interface SendChatMessageDto {
  message: string;
  conversationId?: string;
}

/**
 * Shape final del backend (`ChatMessageResponse` en S5
 * `segurasist-api/src/modules/chatbot/dto/chat-message.dto.ts`):
 *
 *   { conversationId, response, matched, category?, escalated }
 *
 * Mantengo `[extra: string]: unknown` para que S6 pueda agregar campos
 * de personalización (`policyExpiresAt`, `packageName`, etc.) en una
 * respuesta enriquecida sin romper el cliente. Hoy S6 inyecta
 * personalización dentro del campo `response` (vía Handlebars-like
 * placeholders), no como propiedades top-level.
 *
 * Iter 2 transitional fields (`reply`, `messageId`, `author`, `ts`,
 * `policyExpiresAt`, `packageName`) quedan declarados como **opcionales**
 * y `@deprecated` para preservar el typecheck del widget mientras se
 * migra a `response` + `matched` + `escalated`. Sprint 5 los borra y
 * actualiza `chatbot-widget.tsx` para leer `reply.response`.
 */
export interface ChatMessageReply {
  conversationId: string;
  /** Texto de respuesta listo para renderizar (con personalización aplicada por S6). */
  response: string;
  /** `true` si la KB hizo match; `false` para fallback + escalate automático. */
  matched: boolean;
  /** Categoría de la entry KB que respondió (solo si `matched=true`). */
  category?: string;
  /** `true` si este turno disparó escalamiento auto a humano (no-match). */
  escalated: boolean;
  /** @deprecated S4-iter2 — usar `response`. Sprint 5 cleanup. */
  reply?: string;
  /** @deprecated S4-iter2 — el BE no devuelve messageId; widget genera ID local. */
  messageId?: string;
  /** @deprecated S4-iter2 — autor implícito en el contexto del widget. */
  author?: 'bot';
  /** @deprecated S4-iter2 — el widget asigna timestamp local en recepción. */
  ts?: string;
  /** @deprecated S4-iter2 — S6 todavía no expone este campo top-level. */
  policyExpiresAt?: string | null;
  /** @deprecated S4-iter2 — S6 todavía no expone este campo top-level. */
  packageName?: string | null;
  /** Reservado para extensiones S5/S6 (Sprint 5+: `personalization` block). */
  [extra: string]: unknown;
}

export interface EscalateConversationDto {
  conversationId: string;
  reason?: string;
}

/**
 * Shape final del backend (`EscalateResult` en S6
 * `segurasist-api/src/modules/chatbot/dto/escalation.dto.ts`):
 *
 *   { conversationId, alreadyEscalated, emailSentToMac,
 *     acknowledgementSentToInsured }
 *
 * Difiere del shape iter 1 (`{ticketId, status, ackEmailQueued}`):
 *  - NO existe `ticketId` (la idempotencia es coarse-grained vía
 *    `ChatConversation.status='escalated'`; el folio TK-xxx que se
 *    muestra en el widget se deriva del `conversationId`).
 *  - `alreadyEscalated` reemplaza `status: 'created' | 'duplicate'`.
 *  - `emailSentToMac` / `acknowledgementSentToInsured` reemplazan
 *    `ackEmailQueued` con granularidad explícita.
 *
 * Iter 2 transitional fields (`ticketId`, `status`, `ackEmailQueued`)
 * quedan opcionales `@deprecated` para preservar el typecheck de
 * `chatbot-widget.tsx`. Sprint 5 los borra y se migra el widget a
 * `result.conversationId` (folio derivado) + `result.emailSentToMac`.
 */
export interface EscalateConversationResponse {
  conversationId: string;
  /** `true` si la conversación ya estaba escalada (idempotente). */
  alreadyEscalated: boolean;
  /** Email a MAC enviado en este request (`false` si idempotente). */
  emailSentToMac: boolean;
  /** Acuse al asegurado enviado en este request (`false` si idempotente). */
  acknowledgementSentToInsured: boolean;
  /** @deprecated S4-iter2 — derivar de `conversationId`. */
  ticketId?: string;
  /** @deprecated S4-iter2 — derivar de `alreadyEscalated`. */
  status?: 'created' | 'duplicate';
  /** @deprecated S4-iter2 — usar `emailSentToMac` + `acknowledgementSentToInsured`. */
  ackEmailQueued?: boolean;
}

export const chatbotKeys = {
  all: ['chatbot'] as const,
};

/**
 * S4-05 — envía un mensaje al chatbot. El conversationId es opcional en el
 * primer turno; el backend lo asigna y lo devuelve para que el widget lo
 * persista localmente y los siguientes mensajes lo incluyan.
 */
export const useSendChatMessage = () =>
  useMutation({
    mutationFn: (dto: SendChatMessageDto) =>
      api<ChatMessageReply>('/v1/chatbot/message', {
        method: 'POST',
        body: JSON.stringify(dto),
      }),
  });

/**
 * S4-08 — escala la conversación a humano. El backend (owner: S6) emite un
 * correo a MAC con el contexto + acuse al asegurado. El widget muestra el
 * `ticketId` como confirmación. `reason` es opcional para no bloquear al
 * usuario que solo quiere "hablar con humano".
 */
export const useEscalateConversation = () =>
  useMutation({
    mutationFn: (dto: EscalateConversationDto) =>
      api<EscalateConversationResponse>('/v1/chatbot/escalate', {
        method: 'POST',
        body: JSON.stringify(dto),
      }),
  });
