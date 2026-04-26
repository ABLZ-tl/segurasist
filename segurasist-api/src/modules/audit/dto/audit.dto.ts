import { z } from 'zod';

const AuditActionEnum = z.enum([
  'create',
  'update',
  'delete',
  'read',
  'login',
  'logout',
  'export',
  'reissue',
]);

export const AuditLogQuerySchema = z.object({
  actorId: z.string().uuid().optional(),
  action: AuditActionEnum.optional(),
  resourceType: z.string().min(1).max(80).optional(),
  resourceId: z.string().min(1).max(80).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  // Sólo respetado para superadmin; el service ignora este campo si platformAdmin=false.
  tenantId: z.string().uuid().optional(),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;
