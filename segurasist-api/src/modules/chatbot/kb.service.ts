/**
 * S4-06 — KbService.
 *
 * Responsabilidades:
 *
 *   1. **Message flow** (`processMessage`): consume el mensaje del insured,
 *      crea/recupera la conversación activa, persiste el message user,
 *      llama al matcher, persiste el message bot (opcionalmente
 *      personalizado por S6), y emite audit log.
 *
 *   2. **Admin CRUD** (`listEntries`, `createEntry`, `updateEntry`,
 *      `deleteEntry`): gestión de entries de la KB por TENANT_ADMIN.
 *      Soft-delete (sets `deletedAt`); el matcher excluye `deletedAt:not null`
 *      automáticamente vía el filtro `enabled` + `status='published'`.
 *
 *   3. **Personalización**: si `personalization` está disponible (inyectado
 *      desde S6), llama `fillPlaceholders(answer, insuredId)` antes de
 *      persistir el bot reply. Si la personalización falla (insured no
 *      encontrado, etc.), respondemos con el template literal — UX > falla
 *      total.
 *
 *   4. **Escalación**: si el matcher devuelve null, llamamos a
 *      `EscalationService.escalate` (S6). Si el escalation falla por
 *      cualquier razón (SES down, etc.), respondemos un fallback string
 *      al insured y dejamos la conversación en estado activo — el cron de
 *      reintentos (Sprint 5) la barrerá.
 *
 * RBAC + RLS:
 *   - `processMessage` se ejecuta con role `insured` y RLS tenant-scoped.
 *   - Endpoints admin con `admin_mac` y `admin_segurasist`.
 *
 * Audit:
 *   - `chatbot_message_sent` (action enum dedicado, resourceType='chatbot.message')
 *     en cada turno user→bot. Migrado en iter 2 desde el workaround
 *     `action='create'+payloadDiff.event='chatbot.message'` ahora que la
 *     migración `20260429_audit_action_sprint4_extend` agregó el enum value.
 *   - CRUD de KB usa el AuditInterceptor estándar (mutaciones tracked).
 */
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { AuditContextFactory } from '@modules/audit/audit-context.factory';
import { AuditWriterService } from '@modules/audit/audit-writer.service';
import type { ChatMessageResponse } from './dto/chat-message.dto';
import type {
  CreateKbEntryDto,
  KbEntryView,
  ListKbEntriesQuery,
  UpdateKbEntryDto,
} from './dto/kb-entry.dto';
import { EscalationService } from './escalation.service';
import { KbMatcherService, type KbEntryForMatcher } from './kb-matcher.service';
import { PersonalizationService } from './personalization.service';

/** Mensaje devuelto al insured cuando no hay match. UX neutro. */
const FALLBACK_RESPONSE =
  'No tengo una respuesta exacta para tu pregunta. Te conecto con un asesor humano.';

@Injectable()
export class KbService {
  private readonly log = new Logger(KbService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matcher: KbMatcherService,
    private readonly auditWriter: AuditWriterService,
    private readonly auditCtx: AuditContextFactory,
    @Optional() private readonly personalization?: PersonalizationService,
    @Optional() private readonly escalation?: EscalationService,
  ) {}

  // ===========================================================================
  // Message flow
  // ===========================================================================

  /**
   * Procesa un mensaje del insured y devuelve la respuesta del bot.
   *
   * Pipeline:
   *   1. Validar/crear conversation activa para (tenantId, insuredId).
   *   2. Persist user message.
   *   3. Cargar entries published+enabled del tenant. (Filtramos en SQL para
   *      no traerse las entries archived/draft a memoria del matcher.)
   *   4. matcher.findBestMatch → entry|null.
   *   5a. Si match: personalizar (S6), persist bot message con matchedEntryId.
   *   5b. Si no match: escalate (S6) y respond fallback.
   *   6. Audit log con ctx.
   */
  async processMessage(args: {
    tenantId: string;
    insuredId: string;
    message: string;
    conversationId?: string;
  }): Promise<ChatMessageResponse> {
    const { tenantId, insuredId, message } = args;

    // 1) Conversación.
    const conversation = await this.resolveConversation({
      tenantId,
      insuredId,
      conversationId: args.conversationId,
    });

    // 2) User message.
    await this.prisma.client.chatMessage.create({
      data: {
        tenantId,
        insuredId,
        conversationId: conversation.id,
        direction: 'inbound',
        role: 'user',
        content: message,
      },
    });

    // 3) Cargar entries candidatas. RLS tenant-scoped (PrismaService).
    const dbEntries = await this.prisma.client.chatKb.findMany({
      where: {
        enabled: true,
        status: 'published',
        deletedAt: null,
      },
      // Sin orderBy explícito: el matcher tie-breakea por priority + score.
    });

    const entriesForMatcher: KbEntryForMatcher[] = dbEntries.map((e) => ({
      id: e.id,
      category: e.category,
      question: e.question,
      answer: e.answer,
      keywords: e.keywords ?? [],
      synonyms: this.parseSynonyms(e.synonyms),
      priority: e.priority,
      enabled: e.enabled,
    }));

    // 4) Match.
    const match = this.matcher.findBestMatch(message, entriesForMatcher);

    let response: string;
    let matched = false;
    let category: string | undefined;
    let matchedEntryId: string | null = null;
    let escalated = false;

    if (match) {
      matched = true;
      category = match.entry.category;
      matchedEntryId = match.entry.id;
      // 5a) Personalización (S6). Best-effort: si falla, devolvemos template.
      response = await this.personalize(match.entry.answer, insuredId);
    } else {
      // 5b) Escalación. Si el service no está disponible (ej. tests unit sin
      // SES), respondemos fallback sin escalation — el flow no se rompe.
      response = FALLBACK_RESPONSE;
      if (this.escalation) {
        try {
          await this.escalation.escalate(insuredId, conversation.id, message);
          escalated = true;
        } catch (err) {
          this.log.warn(
            { err: err instanceof Error ? err.message : String(err), conversationId: conversation.id },
            'Escalation falló — entregando fallback al insured',
          );
        }
      }
    }

    // 5c) Persistir el bot reply (con matchedEntryId si hubo match).
    await this.prisma.client.chatMessage.create({
      data: {
        tenantId,
        insuredId,
        conversationId: conversation.id,
        direction: 'outbound',
        role: 'bot',
        content: response,
        matchedEntryId,
        escalated,
        confidence: match ? Math.min(1, match.score / 5) : null,
      },
    });

    // 6) Audit log: enum dedicado `chatbot_message_sent` (Sprint 4 iter 2,
    // migración `20260429_audit_action_sprint4_extend`). Reemplaza el workaround
    // iter 1 (`action='create'+payloadDiff.event='chatbot.message'`) — ahora
    // queries SQL "todos los turns del chatbot del último mes" son un simple
    // WHERE action='chatbot_message_sent' sin scan de JSON.
    await this.auditWriter.record({
      ...this.auditCtx.fromRequest(),
      tenantId,
      action: 'chatbot_message_sent',
      resourceType: 'chatbot.message',
      resourceId: conversation.id,
      payloadDiff: {
        matched,
        category,
        matchedEntryId,
        escalated,
        // Mensaje no se persiste en audit (PII) — se infiere por chat_messages.
      },
    });

    return {
      conversationId: conversation.id,
      response,
      matched,
      category,
      escalated,
    };
  }

  /**
   * Recupera o crea una conversación activa para (tenantId, insuredId).
   * Si el cliente trae `conversationId`, validamos que pertenezca al insured
   * y esté activa; si no, lanzamos NotFound (anti-enumeration).
   */
  private async resolveConversation(args: {
    tenantId: string;
    insuredId: string;
    conversationId?: string;
  }): Promise<{ id: string; status: string }> {
    const { tenantId, insuredId, conversationId } = args;

    if (conversationId) {
      const existing = await this.prisma.client.chatConversation.findFirst({
        where: { id: conversationId, tenantId, insuredId },
        select: { id: true, status: true },
      });
      if (!existing) throw new NotFoundException('Conversación no encontrada');
      return existing;
    }

    // Buscamos la conversación activa más reciente; si no hay, creamos una.
    const active = await this.prisma.client.chatConversation.findFirst({
      where: { tenantId, insuredId, status: 'active' },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, status: true },
    });
    if (active) return active;

    const created = await this.prisma.client.chatConversation.create({
      data: { tenantId, insuredId, status: 'active' },
      select: { id: true, status: true },
    });
    return created;
  }

  /**
   * Llama a S6 para reemplazar placeholders. Si el service no está disponible
   * (tests sin S6, container partial init) o el insured no se encuentra,
   * devolvemos el template literal — el insured ve `{{validTo}}` y el bug
   * queda visible para QA en lugar de degradar silente.
   */
  private async personalize(template: string, insuredId: string): Promise<string> {
    if (!this.personalization) return template;
    try {
      return await this.personalization.fillPlaceholders(template, insuredId);
    } catch (err) {
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err), insuredId },
        'Personalización falló — entregando template literal',
      );
      return template;
    }
  }

  // ===========================================================================
  // Admin CRUD
  // ===========================================================================

  /**
   * Lista entries del tenant. RLS asegura tenant-scope; admin_segurasist con
   * `tenantId` en query NO se soporta en este endpoint (los superadmins
   * gestionan KB del tenant via override S3-08 si se requiere).
   */
  async listEntries(tenantId: string, q: ListKbEntriesQuery): Promise<{
    items: KbEntryView[];
    total: number;
  }> {
    void tenantId; // RLS lo aplica el cliente extended.
    const where: Record<string, unknown> = { deletedAt: null };
    if (q.category) where.category = q.category;
    if (q.enabled !== undefined) where.enabled = q.enabled;
    if (q.q) {
      where.OR = [
        { question: { contains: q.q, mode: 'insensitive' } },
        { answer: { contains: q.q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.client.chatKb.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        take: q.limit,
        skip: q.offset,
      }),
      this.prisma.client.chatKb.count({ where }),
    ]);

    return {
      items: items.map((e) => this.mapEntry(e)),
      total,
    };
  }

  async getEntry(tenantId: string, id: string): Promise<KbEntryView> {
    void tenantId;
    const entry = await this.prisma.client.chatKb.findFirst({
      where: { id, deletedAt: null },
    });
    if (!entry) throw new NotFoundException('KB entry no encontrada');
    return this.mapEntry(entry);
  }

  async createEntry(tenantId: string, dto: CreateKbEntryDto): Promise<KbEntryView> {
    const created = await this.prisma.client.chatKb.create({
      data: {
        tenantId,
        category: dto.category,
        question: dto.question,
        answer: dto.answer,
        keywords: dto.keywords,
        synonyms: dto.synonyms ?? {},
        priority: dto.priority ?? 0,
        enabled: dto.enabled ?? true,
        status: dto.status ?? 'published',
      },
    });
    return this.mapEntry(created);
  }

  async updateEntry(
    tenantId: string,
    id: string,
    dto: UpdateKbEntryDto,
  ): Promise<KbEntryView> {
    void tenantId;
    // findFirst antes de update para devolver 404 si la entry está deletada
    // o pertenece a otro tenant (RLS bloquea pero queremos shape consistente).
    const existing = await this.prisma.client.chatKb.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('KB entry no encontrada');

    const data: Record<string, unknown> = {};
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.question !== undefined) data.question = dto.question;
    if (dto.answer !== undefined) data.answer = dto.answer;
    if (dto.keywords !== undefined) data.keywords = dto.keywords;
    if (dto.synonyms !== undefined) data.synonyms = dto.synonyms;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.status !== undefined) data.status = dto.status;

    const updated = await this.prisma.client.chatKb.update({
      where: { id },
      data,
    });
    return this.mapEntry(updated);
  }

  /**
   * Soft-delete: marca `deletedAt = now()`. Los hard delete los hace ops via
   * BD directa si privacy lo requiere (no expuesto por API).
   */
  async deleteEntry(tenantId: string, id: string): Promise<void> {
    void tenantId;
    const existing = await this.prisma.client.chatKb.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('KB entry no encontrada');
    await this.prisma.client.chatKb.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Acepta `synonyms` desde Prisma como `unknown` (Json) y lo coacciona al
   * shape esperado. Si no es un object plano, devolvemos `{}` y logueamos
   * — la entry funcional (sin sinónimos) en lugar de tirar el matcher.
   */
  private parseSynonyms(raw: unknown): Record<string, string[]> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
        out[k] = v as string[];
      }
    }
    return out;
  }

  private mapEntry(e: {
    id: string;
    category: string;
    question: string;
    answer: string;
    keywords: string[];
    synonyms: unknown;
    priority: number;
    enabled: boolean;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): KbEntryView {
    return {
      id: e.id,
      category: e.category,
      question: e.question,
      answer: e.answer,
      keywords: e.keywords ?? [],
      synonyms: this.parseSynonyms(e.synonyms),
      priority: e.priority,
      enabled: e.enabled,
      status: e.status as KbEntryView['status'],
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  /** Para tests externos: usable sin tocar BD. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _assertOwn(_tenantId: string): void {
    // RLS lo enforza; este método queda para evolución (tenant override S3-08).
    if (!_tenantId) throw new ForbiddenException('Tenant context missing');
  }
}
