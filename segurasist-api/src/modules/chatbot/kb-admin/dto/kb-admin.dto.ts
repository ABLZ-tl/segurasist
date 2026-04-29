/**
 * Sprint 5 — S5-3 iter 1.
 *
 * DTOs Zod del editor admin de KB. Reusa el modelo `chat_kb` de Sprint 4
 * con vocabulario nuevo orientado al editor (`intent`, `title`, `body`)
 * mapeado a los campos persistidos (`category`, `question`, `answer`).
 *
 * Razón del rename:
 *   - El brief Sprint 5 pide `intent`/`title`/`body` (lenguaje del editor)
 *     pero el modelo BD trae `category`/`question`/`answer` (lenguaje
 *     del matcher Sprint 4). Mantenemos compat backward — ambos shapes
 *     conviven gracias a un mapper en `kb-admin.service.ts`.
 *   - `intent` viene como slug `1..40` (validado regex). El service lo
 *     persiste en `category` para que el matcher Sprint 4 (que filtra
 *     por categoría en el matcher) siga funcionando sin cambios. Esto
 *     permite que el campo "category" del schema pase de enum cerrado a
 *     slug libre — la BD lo soporta (`VARCHAR(80)` sin CHECK constraint).
 *   - `body` es markdown 1..4000 (vs answer 1..2000 Sprint 4). El editor
 *     UX justifica más espacio; el matcher no usa el body en el scoring
 *     (sólo keywords + sinónimos), así que el cambio es transparente.
 *
 * Throttle, AuditContextFactory y RLS los aplican el controller / service.
 */
import { z } from 'zod';

/**
 * Slug del intent. Debe matchear `^[a-z][a-z0-9-]{0,39}$` — se usa como key
 * lógica del editor (visible en URL admin) y como filter en el matcher.
 */
const IntentSlugSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9-]*$/, 'intent debe ser slug lowercase con guiones (a-z, 0-9, -)');

const TitleSchema = z.string().min(1).max(120);
const BodySchema = z.string().min(1).max(4000);
const KeywordsSchema = z.array(z.string().min(1).max(80)).min(1).max(50);
const PrioritySchema = z.coerce.number().int().min(0).max(100);
const TenantIdSchema = z.string().uuid();

/**
 * Create — `tenantId` opcional en el body:
 *   - SUPERADMIN (`admin_segurasist`): puede setearlo.
 *   - TENANT_ADMIN (`admin_mac`): el service lo IGNORA y usa `req.tenant.id`.
 * El service recibe `effectiveTenantId` ya resuelto.
 */
export const CreateKbEntryAdminSchema = z.object({
  intent: IntentSlugSchema,
  title: TitleSchema,
  body: BodySchema,
  keywords: KeywordsSchema,
  priority: PrioritySchema.default(0),
  enabled: z.boolean().default(true),
  tenantId: TenantIdSchema.optional(),
});
export type CreateKbEntryAdminDto = z.infer<typeof CreateKbEntryAdminSchema>;

/** Update parcial — todos los campos opcionales excepto `id` (path param). */
export const UpdateKbEntryAdminSchema = CreateKbEntryAdminSchema.partial();
export type UpdateKbEntryAdminDto = z.infer<typeof UpdateKbEntryAdminSchema>;

/** Listado paginado con search por title/intent. */
export const ListKbEntriesAdminQuerySchema = z.object({
  q: z.string().min(1).max(120).optional(),
  enabled: z
    .union([z.enum(['true', 'false']), z.boolean()])
    .transform((v) => (typeof v === 'string' ? v === 'true' : v))
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  /** Sólo superadmin: filtrar entries de un tenant específico. */
  tenantId: TenantIdSchema.optional(),
});
export type ListKbEntriesAdminQuery = z.infer<typeof ListKbEntriesAdminQuerySchema>;

/** Test-match — body con la query a probar contra el matcher. */
export const TestMatchSchema = z.object({
  query: z.string().min(1).max(500),
});
export type TestMatchDto = z.infer<typeof TestMatchSchema>;

/** CSV bulk import. Aceptamos texto crudo o array de filas pre-parseado. */
export const ImportKbCsvSchema = z.object({
  /** CSV como string (encabezados: intent,title,body,keywords,priority,enabled). */
  csv: z.string().min(1).max(1024 * 1024),
  /** Si true, hace upsert por (tenantId, intent); si false, INSERT y falla en duplicados. */
  upsert: z.boolean().default(false),
  /** Sólo superadmin. Tenant_admin lo ignora (siempre su propio tenant). */
  tenantId: TenantIdSchema.optional(),
});
export type ImportKbCsvDto = z.infer<typeof ImportKbCsvSchema>;

/** Shape estable de salida del editor. */
export interface KbEntryAdminView {
  id: string;
  tenantId: string;
  intent: string;
  title: string;
  body: string;
  keywords: string[];
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Resultado del test-match: score + keywords matched (sin guardar nada). */
export interface TestMatchResult {
  matched: boolean;
  score: number;
  matchedKeywords: string[];
  matchedSynonyms: string[];
}

/** Resultado del bulk import. */
export interface ImportKbCsvResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
}
