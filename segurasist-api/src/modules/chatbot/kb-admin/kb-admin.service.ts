/**
 * Sprint 5 — S5-3 KbAdminService.
 *
 * CRUD admin del Knowledge Base con vocabulario de editor (`intent`/`title`/
 * `body`) — separado del Sprint 4 `KbService` (que mantiene la nomenclatura
 * matcher `category`/`question`/`answer`) para no romper tests/contracts.
 *
 * Mapeo conceptual:
 *   - intent ↔ category
 *   - title  ↔ question
 *   - body   ↔ answer
 *
 * RBAC + RLS:
 *   - SUPERADMIN (`admin_segurasist`): puede setear `tenantId` en cualquier
 *     mutación; las lecturas tampoco filtran por tenant en el WHERE (RLS
 *     bypass se hace via `PrismaBypassRlsService` solamente si vemos
 *     contexto cross-tenant; en este iter usamos `PrismaService`
 *     request-scoped — el resolveTenantId del service garantiza que el
 *     superadmin pueda forzar tenant via body/query).
 *   - TENANT_ADMIN (`admin_mac`): siempre limitado a `req.tenant.id`. Si el
 *     body trae `tenantId` distinto, lo IGNORAMOS sin error (más resistente
 *     a clientes mal sincronizados que un 403 hard).
 *
 * Audit:
 *   - Cada mutación llama `auditCtx.fromRequest(...)` y registra
 *     `action: 'create' | 'update' | 'delete'` con `resourceType: 'chatbot.kb_entry'`
 *     y `payloadDiff.subAction: 'kb_entry_created' | 'kb_entry_updated' | 'kb_entry_deleted'`.
 *     El brief pedía nuevos enum values (`kb_entry_created/updated/deleted`)
 *     pero el `AuditEventAction` enum aún no los expone — al recibir un
 *     valor desconocido, AuditWriter loguea warn y se cae a `pino-only`.
 *     Para no romper la persistencia y a la vez dejar la query SQL fácil
 *     ("todos los kb_entry_created del último mes" = `WHERE
 *     payload_diff->>'subAction' = 'kb_entry_created'`), usamos el verbo
 *     genérico + subAction. NEW-FINDING tracked en feed S5-3-iter1.
 */
import { PrismaService } from '@common/prisma/prisma.service';
import { AuditContextFactory } from '@modules/audit/audit-context.factory';
import { AuditWriterService } from '@modules/audit/audit-writer.service';
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { KbMatcherService, type KbEntryForMatcher } from '../kb-matcher.service';
import type {
  CreateKbEntryAdminDto,
  ImportKbCsvDto,
  ImportKbCsvResult,
  KbEntryAdminView,
  ListKbEntriesAdminQuery,
  TestMatchResult,
  UpdateKbEntryAdminDto,
} from './dto/kb-admin.dto';

const RESOURCE_TYPE = 'chatbot.kb_entry';

interface CallerCtx {
  /** Roles del JWT — el service decide si superadmin puede forzar tenantId. */
  roles: string[];
  /** Tenant del JWT (puede ser undefined para superadmin sin override). */
  tenantId?: string;
}

@Injectable()
export class KbAdminService {
  private readonly log = new Logger(KbAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matcher: KbMatcherService,
    private readonly auditWriter: AuditWriterService,
    private readonly auditCtx: AuditContextFactory,
  ) {}

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Resuelve el tenant efectivo para la operación. SUPERADMIN puede forzar
   * tenantId distinto; TENANT_ADMIN lo ignora.
   */
  private resolveTenantId(caller: CallerCtx, requested?: string): string {
    if (caller.roles.includes('admin_segurasist')) {
      const t = requested ?? caller.tenantId;
      if (!t) {
        throw new ForbiddenException(
          'Superadmin debe especificar tenantId en body/query (no hay tenant del JWT).',
        );
      }
      return t;
    }
    // tenant_admin / admin_mac: caller.tenantId es obligatorio.
    if (!caller.tenantId) {
      throw new ForbiddenException('Tenant context requerido.');
    }
    return caller.tenantId;
  }

  private mapEntry(e: {
    id: string;
    tenantId: string;
    category: string;
    question: string;
    answer: string;
    keywords: string[];
    priority: number;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): KbEntryAdminView {
    return {
      id: e.id,
      tenantId: e.tenantId,
      intent: e.category,
      title: e.question,
      body: e.answer,
      keywords: e.keywords ?? [],
      priority: e.priority,
      enabled: e.enabled,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  // ===========================================================================
  // CRUD
  // ===========================================================================

  async list(
    caller: CallerCtx,
    q: ListKbEntriesAdminQuery,
  ): Promise<{ items: KbEntryAdminView[]; total: number }> {
    const where: Prisma.ChatKbWhereInput = { deletedAt: null };

    // Tenant scoping. Superadmin puede pasar `tenantId` en query.
    if (caller.roles.includes('admin_segurasist')) {
      if (q.tenantId) where.tenantId = q.tenantId;
      // Si NO trae tenantId, usamos req.tenant.id si existe; si tampoco, listamos todos (BYPASSRLS).
      else if (caller.tenantId) where.tenantId = caller.tenantId;
    } else {
      if (!caller.tenantId) throw new ForbiddenException('Tenant context requerido.');
      where.tenantId = caller.tenantId;
    }

    if (q.enabled !== undefined) where.enabled = q.enabled;
    if (q.q) {
      where.OR = [
        { question: { contains: q.q, mode: Prisma.QueryMode.insensitive } },
        { category: { contains: q.q, mode: Prisma.QueryMode.insensitive } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.client.chatKb.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
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

  async getById(caller: CallerCtx, id: string): Promise<KbEntryAdminView> {
    const entry = await this.prisma.client.chatKb.findFirst({
      where: { id, deletedAt: null },
    });
    if (!entry) throw new NotFoundException('KB entry no encontrada');
    // Defensa profundidad — RLS ya hace el scoping pero validamos.
    if (
      !caller.roles.includes('admin_segurasist') &&
      caller.tenantId &&
      entry.tenantId !== caller.tenantId
    ) {
      throw new NotFoundException('KB entry no encontrada');
    }
    return this.mapEntry(entry);
  }

  async create(caller: CallerCtx, dto: CreateKbEntryAdminDto): Promise<KbEntryAdminView> {
    const tenantId = this.resolveTenantId(caller, dto.tenantId);
    const created = await this.prisma.client.chatKb.create({
      data: {
        tenantId,
        category: dto.intent,
        question: dto.title,
        answer: dto.body,
        keywords: dto.keywords,
        priority: dto.priority ?? 0,
        enabled: dto.enabled ?? true,
        status: 'published',
      },
    });

    void this.auditWriter.record({
      ...this.auditCtx.fromRequest(),
      tenantId,
      action: 'create',
      resourceType: RESOURCE_TYPE,
      resourceId: created.id,
      payloadDiff: {
        subAction: 'kb_entry_created',
        intent: created.category,
        title: created.question,
        priority: created.priority,
        enabled: created.enabled,
      },
    });

    return this.mapEntry(created);
  }

  async update(
    caller: CallerCtx,
    id: string,
    dto: UpdateKbEntryAdminDto,
  ): Promise<KbEntryAdminView> {
    // Find the entry first (404 sólido si no existe / no es del tenant).
    const existing = await this.prisma.client.chatKb.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('KB entry no encontrada');

    if (
      !caller.roles.includes('admin_segurasist') &&
      caller.tenantId &&
      existing.tenantId !== caller.tenantId
    ) {
      throw new NotFoundException('KB entry no encontrada');
    }

    const data: Prisma.ChatKbUpdateInput = {};
    if (dto.intent !== undefined) data.category = dto.intent;
    if (dto.title !== undefined) data.question = dto.title;
    if (dto.body !== undefined) data.answer = dto.body;
    if (dto.keywords !== undefined) data.keywords = dto.keywords;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;

    const updated = await this.prisma.client.chatKb.update({
      where: { id },
      data,
    });

    void this.auditWriter.record({
      ...this.auditCtx.fromRequest(),
      tenantId: existing.tenantId,
      action: 'update',
      resourceType: RESOURCE_TYPE,
      resourceId: id,
      payloadDiff: {
        subAction: 'kb_entry_updated',
        changedFields: Object.keys(data),
      },
    });

    return this.mapEntry(updated);
  }

  async softDelete(caller: CallerCtx, id: string): Promise<void> {
    const existing = await this.prisma.client.chatKb.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('KB entry no encontrada');

    if (
      !caller.roles.includes('admin_segurasist') &&
      caller.tenantId &&
      existing.tenantId !== caller.tenantId
    ) {
      throw new NotFoundException('KB entry no encontrada');
    }

    await this.prisma.client.chatKb.update({
      where: { id },
      data: { deletedAt: new Date(), enabled: false },
    });

    void this.auditWriter.record({
      ...this.auditCtx.fromRequest(),
      tenantId: existing.tenantId,
      action: 'delete',
      resourceType: RESOURCE_TYPE,
      resourceId: id,
      payloadDiff: {
        subAction: 'kb_entry_deleted',
        softDelete: true,
      },
    });
  }

  // ===========================================================================
  // Test-match — re-usa el matcher Sprint 4 sin tocar BD
  // ===========================================================================

  async testMatch(caller: CallerCtx, id: string, query: string): Promise<TestMatchResult> {
    const entry = await this.prisma.client.chatKb.findFirst({
      where: { id, deletedAt: null },
    });
    if (!entry) throw new NotFoundException('KB entry no encontrada');
    if (
      !caller.roles.includes('admin_segurasist') &&
      caller.tenantId &&
      entry.tenantId !== caller.tenantId
    ) {
      throw new NotFoundException('KB entry no encontrada');
    }

    const matchEntry: KbEntryForMatcher = {
      id: entry.id,
      category: entry.category,
      question: entry.question,
      answer: entry.answer,
      keywords: entry.keywords ?? [],
      synonyms: this.parseSynonyms(entry.synonyms),
      priority: entry.priority,
      enabled: entry.enabled,
    };

    const tokens = new Set(this.matcher.tokenize(query));
    const result = this.matcher.scoreEntry(tokens, matchEntry);
    return {
      matched: result.score >= 1,
      score: result.score,
      matchedKeywords: result.matchedKeywords,
      matchedSynonyms: result.matchedSynonyms,
    };
  }

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

  // ===========================================================================
  // CSV bulk import
  // ===========================================================================

  async importCsv(caller: CallerCtx, dto: ImportKbCsvDto): Promise<ImportKbCsvResult> {
    const tenantId = this.resolveTenantId(caller, dto.tenantId);
    const rows = parseCsv(dto.csv);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ row: number; reason: string }> = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      try {
        if (!row || !row.intent || !row.title || !row.body) {
          throw new Error('intent/title/body requeridos');
        }

        if (dto.upsert) {
          // Upsert por (tenantId, intent). No hay UNIQUE en BD → buscamos manual.
          const existing = await this.prisma.client.chatKb.findFirst({
            where: { tenantId, category: row.intent, deletedAt: null },
            select: { id: true },
          });
          if (existing) {
            await this.prisma.client.chatKb.update({
              where: { id: existing.id },
              data: {
                question: row.title,
                answer: row.body,
                keywords: row.keywords,
                priority: row.priority,
                enabled: row.enabled,
              },
            });
            updated += 1;
            continue;
          }
        }

        await this.prisma.client.chatKb.create({
          data: {
            tenantId,
            category: row.intent,
            question: row.title,
            answer: row.body,
            keywords: row.keywords,
            priority: row.priority,
            enabled: row.enabled,
            status: 'published',
          },
        });
        inserted += 1;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        errors.push({ row: i + 1, reason });
        skipped += 1;
      }
    }

    void this.auditWriter.record({
      ...this.auditCtx.fromRequest(),
      tenantId,
      action: 'create',
      resourceType: RESOURCE_TYPE,
      payloadDiff: {
        subAction: 'kb_entry_imported',
        inserted,
        updated,
        skipped,
        upsert: dto.upsert,
      },
    });

    return { inserted, updated, skipped, errors };
  }
}

// ---------------------------------------------------------------------------
// CSV parser muy simple (no necesita PapaParse para este shape pequeño).
// Headers requeridos: intent,title,body,keywords,priority,enabled
// keywords: separados por `|` (porque la coma ya separa columnas).
// ---------------------------------------------------------------------------

interface CsvRow {
  intent: string;
  title: string;
  body: string;
  keywords: string[];
  priority: number;
  enabled: boolean;
}

function parseCsv(csv: string): CsvRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());

  const idx = {
    intent: header.indexOf('intent'),
    title: header.indexOf('title'),
    body: header.indexOf('body'),
    keywords: header.indexOf('keywords'),
    priority: header.indexOf('priority'),
    enabled: header.indexOf('enabled'),
  };
  if (idx.intent < 0 || idx.title < 0 || idx.body < 0) {
    throw new Error('CSV header inválido: faltan columnas intent/title/body');
  }

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]!);
    rows.push({
      intent: (cols[idx.intent] ?? '').trim(),
      title: (cols[idx.title] ?? '').trim(),
      body: (cols[idx.body] ?? '').trim(),
      keywords:
        idx.keywords >= 0
          ? (cols[idx.keywords] ?? '')
              .split('|')
              .map((k) => k.trim())
              .filter((k) => k.length > 0)
          : [],
      priority: idx.priority >= 0 ? Number((cols[idx.priority] ?? '0').trim()) || 0 : 0,
      enabled:
        idx.enabled >= 0 ? (cols[idx.enabled] ?? 'true').trim().toLowerCase() === 'true' : true,
    });
  }
  return rows;
}

/**
 * CSV split simple con soporte de comillas dobles. Suficiente para el
 * formato que el editor admin genera (no es un parser RFC4180 completo —
 * para eso ya hay PapaParse upstream; este path es bulk-internal).
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
