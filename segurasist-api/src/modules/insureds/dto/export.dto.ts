/**
 * S3-09 — DTOs para exportación de listados.
 *
 * `ExportRequestSchema` valida el body del POST. Reusa los filtros de
 * `ListInsuredsQuerySchema` (sin paginación: el export ignora `cursor`/`limit`
 * y exporta TODO lo que matchea, hard-cap a EXPORT_ROW_HARD_CAP para evitar
 * OOMs / megacrayones de PII).
 *
 * `ExportStatusResponse` es la forma del GET /v1/exports/:id.
 */
import { z } from 'zod';

/** Hard cap defensivo: 200k filas. Más allá, mejor un report job dedicado. */
export const EXPORT_ROW_HARD_CAP = 200_000;

/**
 * Subset de filtros válidos para export. Es el mismo shape que
 * `ListInsuredsQuerySchema` pero sin `cursor`/`limit` (el worker ignora
 * paginación y procesa la consulta completa con orderBy estable).
 */
export const ExportFiltersSchema = z.object({
  q: z.string().min(1).max(120).optional(),
  packageId: z.string().uuid().optional(),
  status: z.enum(['active', 'suspended', 'cancelled', 'expired']).optional(),
  validFromGte: z.string().date().optional(),
  validFromLte: z.string().date().optional(),
  validToGte: z.string().date().optional(),
  validToLte: z.string().date().optional(),
  bouncedOnly: z.boolean().optional(),
});
export type ExportFilters = z.infer<typeof ExportFiltersSchema>;

export const ExportRequestSchema = z.object({
  format: z.enum(['xlsx', 'pdf']),
  filters: ExportFiltersSchema.default({}),
});
export type ExportRequestDto = z.infer<typeof ExportRequestSchema>;

export interface ExportRequestResult {
  exportId: string;
  status: 'pending';
}

export interface ExportStatusResponse {
  exportId: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  format: 'xlsx' | 'pdf';
  rowCount: number | null;
  /** Presigned URL — sólo presente cuando status='ready'. TTL 24h. */
  downloadUrl?: string;
  /** ISO timestamp de expiración del presigned. */
  expiresAt?: string;
  /** Hash SHA-256 hex del archivo. Permite verificación post-descarga. */
  hash?: string;
  /** Mensaje human-readable cuando status='failed'. */
  error?: string;
  requestedAt: string;
  completedAt?: string;
}
