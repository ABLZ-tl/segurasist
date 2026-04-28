/**
 * S4-06 — DTOs del CRUD admin de Knowledge Base entries (`/v1/admin/chatbot/kb`).
 *
 * Convenciones:
 *   - `category` enum cerrado en MVP — Sprint 5+ podemos abrirlo a string
 *     libre con catálogo en BD si admin pide más categorías.
 *   - `keywords` se persiste tal cual (lowercase + sin acentos lo hace el
 *     matcher al comparar; ver `kb-matcher.service.ts.tokenize`). Aceptamos
 *     keywords en cualquier capitalización para no fricionar al admin.
 *   - `synonyms` JSON validado como `{ [tokenCanónico]: string[] }` con
 *     límites razonables (≤30 keys, ≤10 sinónimos por key).
 *   - `priority` int entre 0 y 100. >50 = "preferida".
 *   - `enabled` default true en create; admin lo togglea para
 *     pausar entries sin perder histórico.
 *   - `status` enum existente `chat_kb_status` (draft|published|archived) —
 *     filtraremos por `enabled=true AND status='published'` en el matcher.
 */
import { z } from 'zod';

/**
 * Catálogo cerrado MVP. La seed inicial cubre las 5: coverages, claims,
 * certificates, billing, general.
 */
export const KB_CATEGORIES = [
  'coverages',
  'claims',
  'certificates',
  'billing',
  'general',
] as const;

const SynonymsRecordSchema = z
  .record(z.string().min(1).max(80), z.array(z.string().min(1).max(80)).max(10))
  .refine((obj) => Object.keys(obj).length <= 30, {
    message: 'synonyms admite máximo 30 entradas',
  });

export const CreateKbEntrySchema = z.object({
  category: z.enum(KB_CATEGORIES),
  question: z.string().min(3).max(500),
  answer: z.string().min(3).max(2000),
  keywords: z.array(z.string().min(1).max(80)).min(1).max(50),
  synonyms: SynonymsRecordSchema.default({}),
  priority: z.coerce.number().int().min(0).max(100).default(0),
  enabled: z.boolean().default(true),
  status: z.enum(['draft', 'published', 'archived']).default('published'),
});
export type CreateKbEntryDto = z.infer<typeof CreateKbEntrySchema>;

/** Update parcial: todos los campos opcionales. category sigue restringida. */
export const UpdateKbEntrySchema = CreateKbEntrySchema.partial();
export type UpdateKbEntryDto = z.infer<typeof UpdateKbEntrySchema>;

/**
 * Listado admin con filtros básicos. Paginado por offset (los volúmenes
 * esperados de KB por tenant son ≤500; cursor sería over-engineering).
 */
export const ListKbEntriesQuerySchema = z.object({
  category: z.enum(KB_CATEGORIES).optional(),
  enabled: z
    .union([z.enum(['true', 'false']), z.boolean()])
    .transform((v) => (typeof v === 'string' ? v === 'true' : v))
    .optional(),
  q: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListKbEntriesQuery = z.infer<typeof ListKbEntriesQuerySchema>;

/** Shape estable de salida. */
export interface KbEntryView {
  id: string;
  category: string;
  question: string;
  answer: string;
  keywords: string[];
  synonyms: Record<string, string[]>;
  priority: number;
  enabled: boolean;
  status: 'draft' | 'published' | 'archived';
  createdAt: string;
  updatedAt: string;
}
