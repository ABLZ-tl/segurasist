import { z } from 'zod';

export const ListCertificatesQuerySchema = z
  .object({
    insuredId: z.string().uuid().optional(),
    status: z.enum(['issued', 'reissued', 'revoked']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().uuid().optional(),
    /**
     * M2 — Sólo respetado si el caller es `admin_segurasist` (platformAdmin).
     * Ignorado para roles tenant-scoped.
     */
    tenantId: z.string().uuid().optional(),
  })
  .strict();
export type ListCertificatesQuery = z.infer<typeof ListCertificatesQuerySchema>;

export const ReissueCertificateSchema = z
  .object({
    reason: z.string().min(3).max(500),
  })
  .strict();
export type ReissueCertificateDto = z.infer<typeof ReissueCertificateSchema>;

export const ResendEmailSchema = z
  .object({
    to: z.string().email().optional(),
  })
  .strict();
export type ResendEmailDto = z.infer<typeof ResendEmailSchema>;

export const ListEmailEventsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().uuid().optional(),
  })
  .strict();
export type ListEmailEventsQuery = z.infer<typeof ListEmailEventsQuerySchema>;
