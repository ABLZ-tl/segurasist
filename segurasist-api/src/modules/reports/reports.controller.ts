import type { AuthUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { TenantCtx } from '@common/decorators/tenant.decorator';
import { assertPlatformAdmin } from '@common/guards/assert-platform-admin';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { Throttle } from '@common/throttler/throttler.decorators';
import { AuditContextFactory } from '@modules/audit/audit-context.factory';
import { AuditWriterService } from '@modules/audit/audit-writer.service';
import {
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ConciliacionQuerySchema,
  type ConciliacionQuery,
} from './dto/conciliacion-report.dto';
import {
  UtilizacionQuerySchema,
  type UtilizacionQuery,
} from './dto/utilizacion-report.dto';
import {
  VolumetriaQuerySchema,
  type VolumetriaQuery,
} from './dto/volumetria-report.dto';
import { ReportsPdfRendererService } from './reports-pdf-renderer.service';
import { ReportsService, type ReportsScope } from './reports.service';
import { ReportsXlsxRendererService } from './reports-xlsx-renderer.service';

const DashboardQuerySchema = z.object({
  /** M2 — Sólo respetado para admin_segurasist; ignorado para roles tenant-scoped. */
  tenantId: z.string().uuid().optional(),
});

type ReqWithCtx = FastifyRequest & { user?: AuthUser; tenant?: TenantCtx };

@Controller({ path: 'reports', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly pdfRenderer: ReportsPdfRendererService,
    private readonly xlsxRenderer: ReportsXlsxRendererService,
    private readonly auditCtx: AuditContextFactory,
    private readonly auditWriter: AuditWriterService,
  ) {}

  private buildScope(req: ReqWithCtx, queryTenantId: string | undefined): ReportsScope {
    const platformAdmin = req.user?.platformAdmin === true;
    if (platformAdmin) {
      // H-14 — runtime defense-in-depth para PrismaBypassRlsService.
      assertPlatformAdmin(req.user);
    }
    return {
      platformAdmin,
      tenantId: platformAdmin ? queryTenantId : req.tenant?.id,
      actorId: req.user?.id,
    };
  }

  // ------------------------------------------------------------------------
  // Dashboard (S2-05) — preservado.
  // ------------------------------------------------------------------------
  @Get('dashboard')
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor')
  dashboard(
    @Query(new ZodValidationPipe(DashboardQuerySchema)) q: { tenantId?: string },
    @Req() req: ReqWithCtx,
  ) {
    return this.reports.getDashboard(this.buildScope(req, q.tenantId));
  }

  // ------------------------------------------------------------------------
  // S4-01 — Conciliación mensual (PDF / XLSX / JSON).
  //
  // Queries caras → @Throttle 10/min/IP.
  // RBAC: TENANT_ADMIN + PLATFORM_ADMIN (admin_mac, admin_segurasist).
  // Audit: action='export_downloaded' resourceType='reports.conciliacion'.
  // ------------------------------------------------------------------------
  @Get('conciliacion')
  @Roles('admin_segurasist', 'admin_mac')
  @Throttle({ ttl: 60_000, limit: 10 })
  async conciliacion(
    @Query(new ZodValidationPipe(ConciliacionQuerySchema)) q: ConciliacionQuery,
    @Req() req: ReqWithCtx,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<unknown> {
    const scope = this.buildScope(req, q.tenantId);
    const data = await this.reports.getConciliacionReport(q.from, q.to, scope);

    // Audit fire-and-forget — el ctx HTTP viene del factory request-scoped.
    void this.auditWriter.record({
      ...this.auditCtx.fromRequest(),
      tenantId: scope.tenantId ?? '',
      action: q.format === 'json' ? 'read_viewed' : 'export_downloaded',
      resourceType: 'reports.conciliacion',
      payloadDiff: { from: q.from, to: q.to, format: q.format },
    });

    if (q.format === 'pdf') {
      const pdf = await this.pdfRenderer.renderConciliacionPdf(data);
      const filename = `conciliacion-${q.from}-${q.to}.pdf`;
      res.header('Content-Type', 'application/pdf');
      res.header('Content-Disposition', `attachment; filename="${filename}"`);
      res.header('Content-Length', String(pdf.length));
      return pdf;
    }
    if (q.format === 'xlsx') {
      const xlsx = await this.xlsxRenderer.renderConciliacionXlsx(data);
      const filename = `conciliacion-${q.from}-${q.to}.xlsx`;
      res.header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.header('Content-Disposition', `attachment; filename="${filename}"`);
      res.header('Content-Length', String(xlsx.length));
      return xlsx;
    }
    return data;
  }

  // ------------------------------------------------------------------------
  // S4-02 — Volumetría (trend 90 días JSON, FE renderiza chart).
  // ------------------------------------------------------------------------
  @Get('volumetria')
  @Roles('admin_segurasist', 'admin_mac', 'supervisor')
  @Throttle({ ttl: 60_000, limit: 10 })
  async volumetria(
    @Query(new ZodValidationPipe(VolumetriaQuerySchema)) q: VolumetriaQuery,
    @Req() req: ReqWithCtx,
  ) {
    const scope = this.buildScope(req, q.tenantId);
    const data = await this.reports.getVolumetria90(q.days, scope);
    void this.auditWriter.record({
      ...this.auditCtx.fromRequest(),
      tenantId: scope.tenantId ?? '',
      action: 'read_viewed',
      resourceType: 'reports.volumetria',
      payloadDiff: { days: q.days },
    });
    return data;
  }

  // ------------------------------------------------------------------------
  // S4-03 — Utilización por cobertura (Top-N + agregado por paquete).
  // Soporta ?format=pdf|xlsx|json (default json).
  // ------------------------------------------------------------------------
  @Get('utilizacion')
  @Roles('admin_segurasist', 'admin_mac', 'supervisor')
  @Throttle({ ttl: 60_000, limit: 10 })
  async utilizacion(
    @Query(new ZodValidationPipe(UtilizacionQuerySchema)) q: UtilizacionQuery,
    @Req() req: ReqWithCtx,
    @Res({ passthrough: true }) res: FastifyReply,
    @Query('format') formatRaw?: string,
  ): Promise<unknown> {
    const scope = this.buildScope(req, q.tenantId);
    // S1 iter 2 — `packageId` opcional → drilldown por paquete (S2 UI).
    const data = await this.reports.getUtilizacion(q.from, q.to, q.topN, scope, q.packageId);
    const format = formatRaw === 'pdf' || formatRaw === 'xlsx' ? formatRaw : 'json';

    void this.auditWriter.record({
      ...this.auditCtx.fromRequest(),
      tenantId: scope.tenantId ?? '',
      action: format === 'json' ? 'read_viewed' : 'export_downloaded',
      resourceType: 'reports.utilizacion',
      payloadDiff: { from: q.from, to: q.to, topN: q.topN, format, packageId: q.packageId },
    });

    if (format === 'pdf') {
      const pdf = await this.pdfRenderer.renderUtilizacionPdf(data);
      const filename = `utilizacion-${q.from}-${q.to}.pdf`;
      res.header('Content-Type', 'application/pdf');
      res.header('Content-Disposition', `attachment; filename="${filename}"`);
      res.header('Content-Length', String(pdf.length));
      return pdf;
    }
    if (format === 'xlsx') {
      const xlsx = await this.xlsxRenderer.renderUtilizacionXlsx(data);
      const filename = `utilizacion-${q.from}-${q.to}.xlsx`;
      res.header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.header('Content-Disposition', `attachment; filename="${filename}"`);
      res.header('Content-Length', String(xlsx.length));
      return xlsx;
    }
    return data;
  }

  // ------------------------------------------------------------------------
  // Legacy stubs Sprint 0 (matriz RBAC preservada).
  // ------------------------------------------------------------------------
  @Get('conciliation')
  @Roles('admin_segurasist', 'admin_mac', 'supervisor')
  conciliation() {
    throw new HttpException(
      'Endpoint legacy: usar GET /v1/reports/conciliacion?from=&to=&format=',
      HttpStatus.GONE,
    );
  }

  @Get('volumetry')
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor')
  volumetry(
    @Query(new ZodValidationPipe(DashboardQuerySchema)) q: { tenantId?: string },
    @Req() req: ReqWithCtx,
  ) {
    return this.reports.getVolumetrySeries(this.buildScope(req, q.tenantId));
  }

  @Get('usage')
  @Roles('admin_segurasist', 'admin_mac', 'supervisor')
  @Header('X-Deprecated', 'use /v1/reports/utilizacion')
  usage() {
    throw new HttpException(
      'Endpoint legacy: usar GET /v1/reports/utilizacion?from=&to=&topN=&format=',
      HttpStatus.GONE,
    );
  }

  @Post('schedule')
  @Roles('admin_segurasist', 'admin_mac', 'supervisor')
  schedule() {
    throw new HttpException('Schedule no implementado en S4 (owner S3 EventBridge cron)', HttpStatus.NOT_IMPLEMENTED);
  }
}
