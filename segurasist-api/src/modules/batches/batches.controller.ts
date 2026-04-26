import { CurrentUser, AuthUser } from '@common/decorators/current-user.decorator';
import { Roles, Scopes } from '@common/decorators/roles.decorator';
import { Tenant, TenantCtx } from '@common/decorators/tenant.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { BatchesService } from './batches.service';
import {
  ConfirmBatchSchema,
  ListBatchErrorsQuerySchema,
  ListBatchesQuerySchema,
  type ConfirmBatchDto,
  type ListBatchErrorsQuery,
  type ListBatchesQuery,
} from './dto/batch.dto';
import { INSUREDS_TEMPLATE_FILENAME, INSUREDS_TEMPLATE_MIME, LayoutsService } from './layouts.service';

// El layout XLSX vive en este controller (en lugar de un módulo `layouts/`
// dedicado) porque es un asset estrechamente acoplado al flujo de batches:
// mismos roles que pueden subir batches lo descargan, y el contenido define
// las columnas que `BatchesService.upload` validará. Cuando MAC-002 desbloquee
// las columnas oficiales, solo cambia `LayoutsService` — contrato del endpoint
// y RBAC se mantienen.
@Controller({ path: 'batches', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class BatchesController {
  constructor(
    private readonly batches: BatchesService,
    private readonly layouts: LayoutsService,
  ) {}

  @Get('template')
  @Roles('admin_segurasist', 'admin_mac', 'operator')
  async template(@Res({ passthrough: false }) reply: FastifyReply): Promise<void> {
    const buffer = await this.layouts.generateInsuredsTemplate();
    void reply
      .header('Content-Type', INSUREDS_TEMPLATE_MIME)
      .header('Content-Disposition', `attachment; filename="${INSUREDS_TEMPLATE_FILENAME}"`)
      .header('Content-Length', buffer.length)
      .header('Cache-Control', 'no-store')
      .send(buffer);
  }

  @Post()
  @Roles('admin_mac', 'operator', 'admin_segurasist')
  @Scopes('write:batches')
  async upload(@Req() req: FastifyRequest, @Tenant() tenant: TenantCtx, @CurrentUser() user: AuthUser) {
    // multipart parsing handled by @fastify/multipart; service stub for sprint 0.
    const file = await (
      req as unknown as {
        file: () => Promise<
          { filename: string; mimetype: string; toBuffer: () => Promise<Buffer> } | undefined
        >;
      }
    ).file();
    if (!file) {
      return this.batches.upload(
        { buffer: Buffer.alloc(0), filename: 'unknown', mimetype: 'application/octet-stream' },
        tenant,
        user.id,
      );
    }
    const buffer = await file.toBuffer();
    return this.batches.upload({ buffer, filename: file.filename, mimetype: file.mimetype }, tenant, user.id);
  }

  @Get()
  @Roles('admin_mac', 'operator', 'admin_segurasist', 'supervisor')
  @Scopes('read:batches')
  list(
    @Query(new ZodValidationPipe(ListBatchesQuerySchema)) q: ListBatchesQuery,
    @Tenant() tenant: TenantCtx,
  ) {
    return this.batches.list(q, tenant);
  }

  @Get(':id')
  @Roles('admin_mac', 'operator', 'admin_segurasist', 'supervisor')
  @Scopes('read:batches')
  findOne(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() tenant: TenantCtx) {
    return this.batches.findOne(id, tenant);
  }

  @Get(':id/errors')
  @Roles('admin_mac', 'operator', 'admin_segurasist', 'supervisor')
  @Scopes('read:batches')
  listErrors(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(ListBatchErrorsQuerySchema)) q: ListBatchErrorsQuery,
    @Tenant() tenant: TenantCtx,
  ) {
    return this.batches.listErrors(id, q, tenant);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles('admin_mac', 'operator', 'admin_segurasist')
  @Scopes('write:batches')
  confirm(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ConfirmBatchSchema)) dto: ConfirmBatchDto,
    @Tenant() tenant: TenantCtx,
  ) {
    return this.batches.confirm(id, dto, tenant);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles('admin_mac', 'operator', 'admin_segurasist')
  @Scopes('write:batches')
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() tenant: TenantCtx) {
    return this.batches.cancel(id, tenant);
  }
}
