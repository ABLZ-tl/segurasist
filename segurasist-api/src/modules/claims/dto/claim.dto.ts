import { z } from 'zod';

/**
 * Portal asegurado — schema del POST /v1/claims.
 *
 * `type` es el sub-set user-facing (medical/dental/pharmacy/other). El
 * service mappea estos a los valores del enum DB `ClaimType` antes de
 * persistir.
 *
 * `occurredAt` es una fecha YYYY-MM-DD; rechazamos fechas futuras (no se
 * puede reportar un evento que aún no pasó). El zod `.date()` valida formato
 * ISO date; el `.refine` enforza el techo en `today`.
 *
 * `description` 10-500 chars: lo suficiente para "consulta dental dolor" y
 * acotado para que un atacante no use el campo como vector de DoS.
 */
export const CreateClaimSelfSchema = z
  .object({
    type: z.enum(['medical', 'dental', 'pharmacy', 'other']),
    occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'occurredAt debe ser YYYY-MM-DD'),
    description: z.string().min(10).max(500),
  })
  .refine(
    (v) => {
      const today = new Date();
      today.setUTCHours(23, 59, 59, 999);
      return new Date(v.occurredAt) <= today;
    },
    { message: 'occurredAt no puede ser futura', path: ['occurredAt'] },
  );

export type CreateClaimSelfDto = z.infer<typeof CreateClaimSelfSchema>;
