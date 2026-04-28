/**
 * S4-09 — Audit timeline controller.
 *
 * Endpoints:
 *   - GET /v1/audit/timeline?insuredId=:id&cursor=...&limit=20
 *       Roles: admin_segurasist, admin_mac, supervisor (TENANT_ADMIN+).
 *       Throttle: 60/min/IP — la UI dispara hasta ~5 fetches por sesión
 *       (scroll), 60/min cubre operadores legítimos sin permitir scraping.
 *   - GET /v1/audit/timeline/export?insuredId=:id&format=csv
 *       Roles: admin_segurasist, admin_mac, supervisor.
 *       Throttle: 2/min/IP — operación cara (full-table read del insured).
 *       Body es streamed CSV; el cliente arma blob y dispara download.
 *
 * Auditoría de auditoría:
 *   - El export CSV registra un audit event `export_downloaded` con
 *     resourceType='audit.timeline' para que la propia tabla refleje quién
 *     descargó qué timeline. La paginación normal NO se audita (sería ruido).
 */
import type { AuthUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import type { TenantCtx } from '@common/decorators/tenant.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { Throttle } from '@common/throttler/throttler.decorators';
import { Controller, ForbiddenException, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuditContextFactory } from './audit-context.factory';
import { AuditTimelineService } from './audit-timeline.service';
import { AuditWriterService } from './audit-writer.service';
import {
  AuditTimelineExportQuerySchema,
  AuditTimelineQuerySchema,
  AuditTimelineResponseDto,
  type AuditTimelineExportQuery,
  type AuditTimelineQuery,
} from './dto/timeline.dto';

type ReqWithCtx = FastifyRequest & { user?: AuthUser; tenant?: TenantCtx };

@ApiTags('audit')
@Controller({ path: 'audit/timeline', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditTimelineController {
  constructor(
    private readonly timeline: AuditTimelineService,
    private readonly auditWriter: AuditWriterService,
    private readonly auditCtx: AuditContextFactory,
  ) {}

  /**
   * Página keyset del timeline. Filtra por tenant del JWT (RLS) + insuredId.
   */
  @Get()
  @Roles('admin_segurasist', 'admin_mac', 'supervisor')
  @Throttle({ ttl: 60_000, limit: 60 })
  @ApiOperation({ summary: 'Timeline de auditoría paginado por insuredId.' })
  @ApiResponse({ status: 200, type: AuditTimelineResponseDto })
  async list(
    @Query(new ZodValidationPipe(AuditTimelineQuerySchema)) q: AuditTimelineQuery,
    @Req() req: ReqWithCtx,
  ): Promise<AuditTimelineResponseDto> {
    const tenantId = req.tenant?.id;
    if (!tenantId) {
      // TENANT_ADMIN+ sin tenant resuelto = guard mal configurado o JWT sin
      // claim — fail-closed.
      throw new ForbiddenException('Tenant context requerido para timeline.');
    }
    const result = await this.timeline.getTimeline(
      { tenantId },
      {
        insuredId: q.insuredId,
        cursor: q.cursor,
        limit: q.limit,
        actionFilter: q.actionFilter,
      },
    );
    // Mapear a DTO shape (Date → ISO string).
    return {
      items: result.items.map((it) => ({
        id: it.id,
        occurredAt: it.occurredAt.toISOString(),
        action: it.action,
        resourceType: it.resourceType,
        resourceId: it.resourceId,
        actorId: it.actorId,
        actorEmail: it.actorEmail,
        ipMasked: it.ipMasked,
        userAgent: it.userAgent,
        payloadDiff: it.payloadDiff as Record<string, unknown> | unknown[] | null,
      })),
      nextCursor: result.nextCursor,
    };
  }

  /**
   * Streaming CSV export. Throttle 2/min para protegerse del scraping. El
   * propio export queda registrado en `audit_log` (event `export_downloaded`
   * con resourceType='audit.timeline').
   */
  @Get('export')
  @Roles('admin_segurasist', 'admin_mac', 'supervisor')
  @Throttle({ ttl: 60_000, limit: 2 })
  @ApiOperation({ summary: 'Export CSV completo del timeline (streamed).' })
  @ApiResponse({ status: 200, description: 'CSV stream (text/csv).' })
  async exportCsv(
    @Query(new ZodValidationPipe(AuditTimelineExportQuerySchema)) q: AuditTimelineExportQuery,
    @Req() req: ReqWithCtx,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const tenantId = req.tenant?.id;
    if (!tenantId) {
      throw new ForbiddenException('Tenant context requerido para export.');
    }

    // Auditoría de auditoría — registramos ANTES de stream para que quede
    // aunque el cliente cancele a media descarga.
    const ctx = this.auditCtx.fromRequest();
    await this.auditWriter.record({
      tenantId,
      actorId: ctx.actorId,
      action: 'export_downloaded',
      resourceType: 'audit.timeline',
      resourceId: q.insuredId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      traceId: ctx.traceId,
      payloadDiff: {
        event: 'audit.timeline.exported',
        insuredId: q.insuredId,
        format: q.format,
      },
    });

    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="audit-timeline-${q.insuredId}.csv"`)
      // No-cache: CSV puede contener PII; cache intermedios out-of-scope.
      .header('cache-control', 'no-store');

    // Fastify stream: empujamos chunks via `reply.raw.write` y cerramos al
    // final. El generator emite líneas RFC 4180 ya escaped.
    const generator = this.timeline.streamCsv({ tenantId }, q.insuredId);
    for await (const line of generator) {
      reply.raw.write(line);
    }
    reply.raw.end();
  }
}
