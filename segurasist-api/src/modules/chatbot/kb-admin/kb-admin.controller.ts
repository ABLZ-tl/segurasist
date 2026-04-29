/**
 * Sprint 5 — S5-3 KbAdminController.
 *
 * Reemplaza `AdminChatbotKbController` (Sprint 4 chatbot.controller.ts) bajo
 * el mismo path `/v1/admin/chatbot/kb`. Soporta tanto el contrato Sprint 5
 * (`PUT /:id`, `POST /:id/test-match`, `POST /import`) como el contrato
 * Sprint 4 (`PATCH /:id`) para no romper `cross-tenant.spec.ts` que aún
 * golpea `PATCH /v1/admin/chatbot/kb/:id`.
 *
 * Roles aceptados:
 *   - `admin_segurasist` (superadmin) — puede pasar `tenantId` en body/query.
 *   - `admin_mac`        (tenant_admin) — siempre limitado a su tenant via JWT.
 *   - `supervisor`       — read-only (GET).
 *
 * Throttle: hereda el global default (60/min). Mutaciones tienen un
 * `@Throttle({ttl: 60_000, limit: 30})` adicional para limitar bursts del
 * editor admin (caso típico: paste-bombing CSV de 100 entries en ráfaga).
 */
import { CurrentUser, type AuthUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { Throttle } from '@common/throttler/throttler.decorators';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CreateKbEntryAdminSchema,
  ImportKbCsvSchema,
  ListKbEntriesAdminQuerySchema,
  TestMatchSchema,
  UpdateKbEntryAdminSchema,
  type CreateKbEntryAdminDto,
  type ImportKbCsvDto,
  type ImportKbCsvResult,
  type KbEntryAdminView,
  type ListKbEntriesAdminQuery,
  type TestMatchDto,
  type TestMatchResult,
  type UpdateKbEntryAdminDto,
} from './dto/kb-admin.dto';
import { KbAdminService } from './kb-admin.service';

@ApiTags('admin-chatbot-kb')
@Controller({ path: 'admin/chatbot/kb', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class KbAdminController {
  constructor(private readonly svc: KbAdminService) {}

  @Get()
  @Roles('admin_mac', 'admin_segurasist', 'supervisor')
  @ApiOperation({ summary: 'Lista paginada de entries (search por title/intent).' })
  async list(
    @Query(new ZodValidationPipe(ListKbEntriesAdminQuerySchema)) q: ListKbEntriesAdminQuery,
    @Req() req: FastifyRequest & { tenant?: { id: string } },
    @CurrentUser() user: AuthUser,
  ): Promise<{ items: KbEntryAdminView[]; total: number }> {
    return this.svc.list(
      { roles: [user.role].filter(Boolean), tenantId: req.tenant?.id },
      q,
    );
  }

  @Get(':id')
  @Roles('admin_mac', 'admin_segurasist', 'supervisor')
  async getOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest & { tenant?: { id: string } },
    @CurrentUser() user: AuthUser,
  ): Promise<KbEntryAdminView> {
    return this.svc.getById({ roles: [user.role].filter(Boolean), tenantId: req.tenant?.id }, id);
  }

  @Post()
  @Roles('admin_mac', 'admin_segurasist')
  @Throttle({ ttl: 60_000, limit: 30 })
  @ApiOperation({ summary: 'Crea una entry de KB.' })
  @ApiResponse({ status: 201, description: 'Entry creada.' })
  async create(
    @Body(new ZodValidationPipe(CreateKbEntryAdminSchema)) dto: CreateKbEntryAdminDto,
    @Req() req: FastifyRequest & { tenant?: { id: string } },
    @CurrentUser() user: AuthUser,
  ): Promise<KbEntryAdminView> {
    return this.svc.create({ roles: [user.role].filter(Boolean), tenantId: req.tenant?.id }, dto);
  }

  /**
   * PUT canónico Sprint 5 — full update. El service consume Update DTO
   * partial igual que PATCH (idempotente; no hay diferencia semántica de
   * lado servidor — el contrato HTTP queda más limpio).
   */
  @Put(':id')
  @Roles('admin_mac', 'admin_segurasist')
  @Throttle({ ttl: 60_000, limit: 30 })
  async updatePut(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateKbEntryAdminSchema)) dto: UpdateKbEntryAdminDto,
    @Req() req: FastifyRequest & { tenant?: { id: string } },
    @CurrentUser() user: AuthUser,
  ): Promise<KbEntryAdminView> {
    return this.svc.update({ roles: [user.role].filter(Boolean), tenantId: req.tenant?.id }, id, dto);
  }

  /**
   * PATCH compat Sprint 4 — el cross-tenant test integration (`cross-tenant.spec.ts`)
   * golpea `PATCH /v1/admin/chatbot/kb/:id` con `{priority: 99}`. Mantenemos
   * el verbo activo para preservar baseline 1222/1222 verde.
   *
   * Soporta el shape Sprint 4 (`{priority, enabled, ...}`) Y el shape Sprint 5
   * (`{intent, title, body, ...}`) — el Update DTO es partial y los campos
   * sólo aplican si están presentes. Si llega `category` (Sprint 4) lo
   * normalizamos a `intent` antes de validar.
   */
  @Patch(':id')
  @Roles('admin_mac', 'admin_segurasist')
  @Throttle({ ttl: 60_000, limit: 30 })
  async updatePatch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() rawBody: Record<string, unknown>,
    @Req() req: FastifyRequest & { tenant?: { id: string } },
    @CurrentUser() user: AuthUser,
  ): Promise<KbEntryAdminView> {
    // Normalización legacy (Sprint 4 vocab → Sprint 5 vocab).
    const normalized = { ...rawBody };
    if ('category' in normalized && !('intent' in normalized)) {
      normalized.intent = normalized.category;
      delete normalized.category;
    }
    if ('question' in normalized && !('title' in normalized)) {
      normalized.title = normalized.question;
      delete normalized.question;
    }
    if ('answer' in normalized && !('body' in normalized)) {
      normalized.body = normalized.answer;
      delete normalized.answer;
    }
    const parsed = UpdateKbEntryAdminSchema.parse(normalized);
    return this.svc.update({ roles: [user.role].filter(Boolean), tenantId: req.tenant?.id }, id, parsed);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('admin_mac', 'admin_segurasist')
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest & { tenant?: { id: string } },
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.svc.softDelete({ roles: [user.role].filter(Boolean), tenantId: req.tenant?.id }, id);
  }

  /**
   * Probar query → match score sin guardar. UX: el editor admin escribe
   * una entry, pega un mensaje de prueba, y ve si el matcher la elige.
   */
  @Post(':id/test-match')
  @Roles('admin_mac', 'admin_segurasist', 'supervisor')
  @Throttle({ ttl: 60_000, limit: 60 })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Prueba un query contra una entry — sin persistir.' })
  async testMatch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(TestMatchSchema)) dto: TestMatchDto,
    @Req() req: FastifyRequest & { tenant?: { id: string } },
    @CurrentUser() user: AuthUser,
  ): Promise<TestMatchResult> {
    return this.svc.testMatch({ roles: [user.role].filter(Boolean), tenantId: req.tenant?.id }, id, dto.query);
  }

  /**
   * Bulk import desde CSV. Headers requeridos: intent,title,body,keywords,priority,enabled.
   * keywords se separan con `|` (no coma — la coma ya separa columnas).
   */
  @Post('import')
  @Roles('admin_mac', 'admin_segurasist')
  @Throttle({ ttl: 60_000, limit: 5 })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk import CSV de entries KB.' })
  async importCsv(
    @Body(new ZodValidationPipe(ImportKbCsvSchema)) dto: ImportKbCsvDto,
    @Req() req: FastifyRequest & { tenant?: { id: string } },
    @CurrentUser() user: AuthUser,
  ): Promise<ImportKbCsvResult> {
    return this.svc.importCsv({ roles: [user.role].filter(Boolean), tenantId: req.tenant?.id }, dto);
  }
}
