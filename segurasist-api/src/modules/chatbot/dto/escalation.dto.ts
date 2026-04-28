/**
 * S4-08 — DTOs Zod para el flow de escalamiento human-in-the-loop.
 *
 * Schemas Zod (no class-validator) para mantener consistencia con el resto
 * del API (todos los DTOs Sprint 1+ usan Zod + ZodValidationPipe global). El
 * controller (S5) crea el pipeline `body -> EscalateRequestSchema.parse`.
 */
import { z } from 'zod';

/**
 * Body del POST `/v1/chatbot/escalate`. El insuredId NO viaja en el body —
 * se deriva del JWT (`req.user.insuredId`) en el controller. Esto evita que
 * un asegurado escale en nombre de otro.
 */
export const EscalateRequestSchema = z
  .object({
    /** UUID de la conversación a escalar. */
    conversationId: z.string().uuid({ message: 'conversationId debe ser UUID' }),
    /**
     * Razón / mensaje del asegurado al equipo MAC (libre, hasta 500 chars).
     * Sanitizado a trim — el HTML del email se renderiza con escape para
     * prevenir XSS si MAC abre el correo en un cliente con preview.
     */
    reason: z
      .string()
      .trim()
      .min(1, { message: 'reason no puede estar vacío' })
      .max(500, { message: 'reason no puede exceder 500 caracteres' }),
  })
  .strict();

export type EscalateRequestDto = z.infer<typeof EscalateRequestSchema>;

/**
 * Resultado del escalamiento — devuelto al cliente para confirmar UX.
 * `alreadyEscalated=true` significa que la conversación YA estaba escalada
 * (idempotencia) y NO se reenviaron correos.
 */
export interface EscalateResult {
  conversationId: string;
  alreadyEscalated: boolean;
  /** Email a soporte enviado en este request (false si idempotente). */
  emailSentToMac: boolean;
  /** Acuse al asegurado enviado en este request (false si idempotente). */
  acknowledgementSentToInsured: boolean;
}
