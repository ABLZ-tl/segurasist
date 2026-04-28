/**
 * S4-09 — Timeline endpoint DTOs.
 *
 * Endpoints:
 *   - GET /v1/audit/timeline?insuredId=:id&cursor=...&limit=20
 *   - GET /v1/audit/timeline/export?insuredId=:id&format=csv
 *
 * Diseño:
 *   - `insuredId` es REQUIRED (UUID). El endpoint sólo devuelve eventos
 *     vinculados al asegurado, ya sea por `resourceType='insureds' AND
 *     resourceId=insuredId` o por payloadDiff.insuredId (claims, certificates
 *     y demás resources hijos que llevan ese campo en su payload).
 *   - `cursor` opaco base64url(JSON({id, occurredAt})) — keyset por
 *     `(occurredAt DESC, id DESC)`. Mismo codec que `audit-cursor.ts`.
 *   - `limit` 1..100, default 20 (timeline UI carga páginas pequeñas + scroll).
 *   - `format` siempre `csv` por ahora; placeholder por si Sprint 5 añade JSON
 *     stream. El controller valida explícitamente.
 *   - `actionFilter` (opcional): filtrar por tipo de acción (dropdown FE).
 *
 * Qué NO se expone:
 *   - prevHash/rowHash (la tabla mutable es ground-truth para integrity, no
 *     para consumo del UI; verificación corre via `/v1/audit/verify-chain`).
 *   - tenantId (siempre el del JWT — exposición = leak inútil).
 */
import { ApiProperty } from '@nestjs/swagger';
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
  'otp_requested',
  'otp_verified',
  'read_viewed',
  'read_downloaded',
  'export_downloaded',
]);

export const AuditTimelineQuerySchema = z.object({
  insuredId: z.string().uuid(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  actionFilter: AuditActionEnum.optional(),
});
export type AuditTimelineQuery = z.infer<typeof AuditTimelineQuerySchema>;

export const AuditTimelineExportQuerySchema = z.object({
  insuredId: z.string().uuid(),
  format: z.enum(['csv']).default('csv'),
});
export type AuditTimelineExportQuery = z.infer<typeof AuditTimelineExportQuerySchema>;

export class AuditTimelineItemDto {
  @ApiProperty({ example: 'd2a2b8f4-1d6c-49a7-9d5d-8a3b1e0f6c11' })
  id!: string;

  @ApiProperty({ example: '2026-04-25T12:34:56.000Z' })
  occurredAt!: string;

  @ApiProperty({
    example: 'update',
    description: 'Acción canónica (enum AuditAction).',
  })
  action!: string;

  @ApiProperty({ example: 'insureds' })
  resourceType!: string;

  @ApiProperty({
    example: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    nullable: true,
  })
  resourceId!: string | null;

  @ApiProperty({
    example: 'u-actor-1',
    nullable: true,
    description: 'Actor que ejecutó la acción. null si es sistema (worker).',
  })
  actorId!: string | null;

  @ApiProperty({
    example: 'op@mac.local',
    nullable: true,
    description: 'Email hidratado del actor (best-effort lookup).',
  })
  actorEmail!: string | null;

  @ApiProperty({
    example: '189.99.99.*',
    nullable: true,
    description: 'IP enmascarada — IPv4 último octeto, IPv6 primeros 2 grupos.',
  })
  ipMasked!: string | null;

  @ApiProperty({
    example: 'Mozilla/5.0 ...',
    nullable: true,
  })
  userAgent!: string | null;

  @ApiProperty({
    type: 'object',
    nullable: true,
    description: 'Diff scrubbeado (sin secretos). FE lo renderiza expandible.',
    additionalProperties: true,
  })
  payloadDiff!: Record<string, unknown> | unknown[] | null;
}

export class AuditTimelineResponseDto {
  @ApiProperty({ type: [AuditTimelineItemDto] })
  items!: AuditTimelineItemDto[];

  @ApiProperty({
    example: 'eyJpZCI6IjAuLi4iLCJvY2N1cnJlZEF0IjoiMjAyNi0wNC0yNVQxMjozNDo1Ni4wMDBaIn0',
    nullable: true,
    description: 'Cursor opaco para fetchNextPage; null si no hay más páginas.',
  })
  nextCursor!: string | null;
}
