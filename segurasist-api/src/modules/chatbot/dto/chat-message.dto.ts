/**
 * S4-06 — DTOs del flujo `POST /v1/chatbot/message` consumido por el portal
 * del insured.
 *
 * Decisiones:
 *   - `message` ≤ 1000 chars (UX widget); más allá se rechaza con 422 antes
 *     de llamar al matcher (ahorra ciclos y bloquea ataques de prompt-bomb).
 *   - `conversationId` opcional: si viene, intentamos seguir esa conversación;
 *     si no, el service crea/recupera la activa del insured.
 *   - Response shape conservador: siempre `response: string` (incluso fallback
 *     "no encontré información"), `matched: boolean` para que el FE pueda
 *     renderear sugerencias / botón de escalación cuando `matched=false`,
 *     `conversationId` para que el cliente lo persista localmente.
 */
import { z } from 'zod';

/** Validation schema. El controller usa ZodValidationPipe directamente. */
export const ChatMessageSchema = z.object({
  message: z
    .string()
    .min(1, { message: 'message requerido' })
    .max(1000, { message: 'message excede 1000 chars' }),
  /**
   * Si el cliente trae un id de conversación previa, lo respetamos siempre
   * que pertenezca al mismo insured + tenant (RLS garantiza la última parte;
   * el service valida insuredId).
   */
  conversationId: z.string().uuid().optional(),
});
export type ChatMessageDto = z.infer<typeof ChatMessageSchema>;

/** Response shape estable para el FE. Sprint 5+ puede agregar `suggestions`. */
export interface ChatMessageResponse {
  conversationId: string;
  response: string;
  matched: boolean;
  /** Categoría de la entry KB que respondió, si hubo match. */
  category?: string;
  /** Si la conversación quedó escalada por este turno (no-match → operator). */
  escalated: boolean;
}
