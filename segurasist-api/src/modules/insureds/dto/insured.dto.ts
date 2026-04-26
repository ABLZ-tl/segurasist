import { z } from 'zod';

export const BeneficiarySchema = z.object({
  fullName: z.string().min(3).max(160),
  relationship: z.enum(['spouse', 'child', 'parent', 'sibling', 'other']),
  dob: z.string().date(),
  curp: z
    .string()
    .regex(/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/)
    .optional(),
});
export type BeneficiaryDto = z.infer<typeof BeneficiarySchema>;

export const CreateInsuredSchema = z
  .object({
    curp: z.string().regex(/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/),
    rfc: z
      .string()
      .regex(/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/)
      .optional(),
    fullName: z.string().min(3).max(120),
    dob: z.string().date(),
    email: z.string().email().optional(),
    phone: z
      .string()
      .regex(/^\+?\d{10,15}$/)
      .optional(),
    packageId: z.string().uuid(),
    validFrom: z.string().date(),
    validTo: z.string().date(),
    beneficiaries: z.array(BeneficiarySchema).max(10).optional(),
  })
  .refine((d) => new Date(d.validTo) > new Date(d.validFrom), {
    message: 'validTo debe ser posterior a validFrom',
    path: ['validTo'],
  });
export type CreateInsuredDto = z.infer<typeof CreateInsuredSchema>;

export const UpdateInsuredSchema = CreateInsuredSchema.innerType().partial();
export type UpdateInsuredDto = z.infer<typeof UpdateInsuredSchema>;

/**
 * S2-06 — Listado avanzado.
 *
 * Cursor opaco base64-encoded de `{lastId, lastCreatedAt}`. El endpoint
 * decodifica/encoda en `InsuredsService.list`. El cliente NO debe
 * inspeccionarlo.
 *
 * `bouncedOnly=true` filtra a insureds que tienen al menos un EmailEvent
 * tipo `bounced` registrado (hard bounce). Útil para QA de deliverability.
 */
export const ListInsuredsQuerySchema = z.object({
  q: z.string().min(1).max(120).optional(),
  packageId: z.string().uuid().optional(),
  status: z.enum(['active', 'suspended', 'cancelled', 'expired']).optional(),
  validFrom: z.string().date().optional(),
  validTo: z.string().date().optional(),
  validFromGte: z.string().date().optional(),
  validFromLte: z.string().date().optional(),
  validToGte: z.string().date().optional(),
  validToLte: z.string().date().optional(),
  bouncedOnly: z
    .union([z.enum(['true', 'false']), z.boolean()])
    .transform((v) => (typeof v === 'string' ? v === 'true' : v))
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type ListInsuredsQuery = z.infer<typeof ListInsuredsQuerySchema>;
