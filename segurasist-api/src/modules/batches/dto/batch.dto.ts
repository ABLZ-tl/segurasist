import { z } from 'zod';

export const ListBatchesQuerySchema = z.object({
  status: z
    .enum(['validating', 'preview_ready', 'processing', 'completed', 'failed', 'cancelled'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  /**
   * M2 — Sólo respetado si el caller es `admin_segurasist` (platformAdmin).
   * Para los demás roles está limitado por su JWT y se ignora.
   */
  tenantId: z.string().uuid().optional(),
});
export type ListBatchesQuery = z.infer<typeof ListBatchesQuerySchema>;

export const ConfirmBatchSchema = z.object({
  rowsToInclude: z.array(z.number().int().nonnegative()).optional(),
});
export type ConfirmBatchDto = z.infer<typeof ConfirmBatchSchema>;

export const ListBatchErrorsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().optional(),
});
export type ListBatchErrorsQuery = z.infer<typeof ListBatchErrorsQuerySchema>;
