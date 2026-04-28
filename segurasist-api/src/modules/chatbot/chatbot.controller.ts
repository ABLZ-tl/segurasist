/**
 * S4-06 — Chatbot controllers.
 *
 * Dos rutas exposed (mismo módulo, dos `@Controller`):
 *
 *   1) `/v1/chatbot/*` — endpoints del insured (portal). Roles: `insured`.
 *      - POST /v1/chatbot/message → procesa el turno user→bot.
 *
 *   2) `/v1/admin/chatbot/kb/*` — CRUD de KB entries. Roles: `admin_mac`,
 *      `admin_segurasist`. (TENANT_ADMIN+ pueden gestionar el contenido del
 *      bot; operadores y supervisors lo consumen desde el portal admin.)
 *
 * Throttle:
 *   - Insureds: 30 msg/min — más allá es ataque/bot. El widget UX promedia
 *     1 msg/10s con un humano; 30/min deja margen para correcciones rápidas
 *     pero detiene scraping.
 *   - Admin CRUD: hereda el global default (60/min). Operación de bajo
 *     volumen, no requiere override custom.
 *
 * RLS + audit:
 *   - PrismaService request-scoped → `app.current_tenant` viene del JWT.
 *   - AuditWriter via AuditContextFactory en el message flow (S5 owned).
 *   - El AuditInterceptor global cubre create/update/delete del CRUD.
 */
import { CurrentUser, type AuthUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { Tenant, type TenantCtx } from '@common/decorators/tenant.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { Throttle } from '@common/throttler/throttler.decorators';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ChatMessageSchema, type ChatMessageDto, type ChatMessageResponse } from './dto/chat-message.dto';
import { EscalateRequestSchema, type EscalateRequestDto, type EscalateResult } from './dto/escalation.dto';
import {
  CreateKbEntrySchema,
  ListKbEntriesQuerySchema,
  UpdateKbEntrySchema,
  type CreateKbEntryDto,
  type KbEntryView,
  type ListKbEntriesQuery,
  type UpdateKbEntryDto,
} from './dto/kb-entry.dto';
import { EscalationService } from './escalation.service';
import { KbService } from './kb.service';

// ============================================================================
// 1) Insured-facing endpoints
// ============================================================================

@ApiTags('chatbot')
@Controller({ path: 'chatbot', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatbotController {
  constructor(
    private readonly kb: KbService,
    private readonly escalation: EscalationService,
  ) {}

  /**
   * Procesa un mensaje del insured. Throttle 30/min — el widget UX no
   * supera ~6 msg/min en uso normal.
   *
   * `insuredId` se deriva del JWT (`req.user.id` mapea al user-row del pool
   * insured; el match con `Insured.id` ocurre vía `cognitoSub`). Aquí
   * confiamos en `req.user.id` como insuredId — el JwtAuthGuard ya validó
   * que el pool sea `insured`.
   *
   * RLS: `tenantId` viene del Tenant decorator (JWT). El service pasa al
   * matcher solo entries del tenant gracias a PrismaService request-scoped.
   */
  @Post('message')
  @Roles('insured')
  @Throttle({ ttl: 60_000, limit: 30 })
  @ApiOperation({ summary: 'Envía un mensaje al chatbot y devuelve la respuesta.' })
  @ApiResponse({ status: 200, description: 'Respuesta del chatbot (matched o fallback).' })
  async message(
    @Body(new ZodValidationPipe(ChatMessageSchema)) dto: ChatMessageDto,
    @Tenant() tenant: TenantCtx,
    @CurrentUser() user: AuthUser,
  ): Promise<ChatMessageResponse> {
    // El insuredId conceptual = user.id en el portal (1 user pool insured = 1 insured-row).
    return this.kb.processMessage({
      tenantId: tenant.id,
      insuredId: user.id,
      message: dto.message,
      conversationId: dto.conversationId,
    });
  }

  /**
   * S4-08 — Escalamiento "hablar con humano". El widget portal invoca este
   * endpoint cuando el insured pide hablar con un agente real. Idempotente:
   * re-llamadas con misma `conversationId` retornan `alreadyEscalated:true`
   * sin re-enviar emails (defensa contra double-click).
   */
  @Post('escalate')
  @Roles('insured')
  @Throttle({ ttl: 60_000, limit: 5 })
  @ApiOperation({ summary: 'Escala una conversación a soporte humano (MAC).' })
  @ApiResponse({ status: 200, description: 'Resultado del escalamiento (idempotente).' })
  async escalate(
    @Body(new ZodValidationPipe(EscalateRequestSchema)) dto: EscalateRequestDto,
    @CurrentUser() user: AuthUser,
  ): Promise<EscalateResult> {
    return this.escalation.escalate(user.id, dto.conversationId, dto.reason);
  }
}

// ============================================================================
// 2) Admin CRUD endpoints
// ============================================================================

@ApiTags('admin-chatbot')
@Controller({ path: 'admin/chatbot/kb', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminChatbotKbController {
  constructor(private readonly kb: KbService) {}

  /**
   * Listado paginado para la consola admin. Filtros: category, enabled, q.
   */
  @Get()
  @Roles('admin_mac', 'admin_segurasist', 'supervisor')
  @ApiOperation({ summary: 'Lista entries del KB del tenant (admin).' })
  async list(
    @Query(new ZodValidationPipe(ListKbEntriesQuerySchema)) q: ListKbEntriesQuery,
    @Tenant() tenant: TenantCtx,
  ): Promise<{ items: KbEntryView[]; total: number }> {
    return this.kb.listEntries(tenant.id, q);
  }

  @Get(':id')
  @Roles('admin_mac', 'admin_segurasist', 'supervisor')
  async getOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Tenant() tenant: TenantCtx,
  ): Promise<KbEntryView> {
    return this.kb.getEntry(tenant.id, id);
  }

  @Post()
  @Roles('admin_mac', 'admin_segurasist')
  @ApiOperation({ summary: 'Crea una entry de KB.' })
  async create(
    @Body(new ZodValidationPipe(CreateKbEntrySchema)) dto: CreateKbEntryDto,
    @Tenant() tenant: TenantCtx,
    @CurrentUser() user: AuthUser,
  ): Promise<KbEntryView> {
    // TENANT_ADMIN policy explícita: si el caller es admin_segurasist y el
    // tenant no resolvió (cross-tenant gestionado vía override S3-08), fail.
    if (!tenant.id) throw new ForbiddenException('Tenant context requerido para crear KB.');
    void user;
    return this.kb.createEntry(tenant.id, dto);
  }

  @Patch(':id')
  @Roles('admin_mac', 'admin_segurasist')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateKbEntrySchema)) dto: UpdateKbEntryDto,
    @Tenant() tenant: TenantCtx,
  ): Promise<KbEntryView> {
    return this.kb.updateEntry(tenant.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('admin_mac', 'admin_segurasist')
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() tenant: TenantCtx): Promise<void> {
    await this.kb.deleteEntry(tenant.id, id);
  }
}
