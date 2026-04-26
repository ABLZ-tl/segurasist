/**
 * S2-02 — Package + Coverage DTOs.
 *
 * Schemas Zod compartidos con el FE. El FE importa el `.shape` (vía OpenAPI)
 * o re-declara mismo schema en `apps/admin/components/packages/package-editor`.
 *
 * Reglas de negocio críticas:
 *   - `name` único por tenant (constraint DB).
 *   - `status` enum {active|archived}; el archive lo hace patch al status, no
 *     DELETE físico (evita romper FKs hacia insureds históricos).
 *   - Coverages embebidas en create/update permite atomicidad: el upsert
 *     reemplaza el set entero en transacción (ver
 *     `CoveragesService.upsertForPackage`).
 *   - Coverage type=count ⇒ limit_count requerido; type=amount ⇒ limit_amount.
 *     El refine de Zod lo valida antes de tocar la BD.
 */
import { z } from 'zod';

export const CoverageTypeSchema = z.enum(['count', 'amount']);
export type CoverageTypeDto = z.infer<typeof CoverageTypeSchema>;

export const CoverageInputSchema = z
  .object({
    name: z.string().min(2).max(120),
    type: CoverageTypeSchema,
    limitCount: z.number().int().positive().nullish(),
    limitAmount: z.number().positive().nullish(),
    unit: z.string().min(1).max(20),
    description: z.string().max(500).nullish(),
  })
  .refine((c) => (c.type === 'count' ? typeof c.limitCount === 'number' : true), {
    message: 'limitCount es requerido cuando type=count',
    path: ['limitCount'],
  })
  .refine((c) => (c.type === 'amount' ? typeof c.limitAmount === 'number' : true), {
    message: 'limitAmount es requerido cuando type=amount',
    path: ['limitAmount'],
  });
export type CoverageInputDto = z.infer<typeof CoverageInputSchema>;

export const PackageStatusSchema = z.enum(['active', 'archived']);
export type PackageStatusDto = z.infer<typeof PackageStatusSchema>;

export const CreatePackageSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).nullish(),
  status: PackageStatusSchema.default('active'),
  coverages: z.array(CoverageInputSchema).max(40).default([]),
});
export type CreatePackageDto = z.infer<typeof CreatePackageSchema>;

export const UpdatePackageSchema = CreatePackageSchema.partial();
export type UpdatePackageDto = z.infer<typeof UpdatePackageSchema>;

export const ListPackagesQuerySchema = z.object({
  q: z.string().min(1).max(120).optional(),
  active: z
    .union([z.enum(['true', 'false']), z.boolean()])
    .transform((v) => (typeof v === 'string' ? v === 'true' : v))
    .optional(),
  status: PackageStatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /**
   * M2 — Sólo respetado si el caller es `admin_segurasist` (platformAdmin).
   * Para los demás roles está limitado por su JWT y se ignora.
   */
  tenantId: z.string().uuid().optional(),
});
export type ListPackagesQuery = z.infer<typeof ListPackagesQuerySchema>;
