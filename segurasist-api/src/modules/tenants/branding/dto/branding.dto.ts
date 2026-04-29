import { z } from 'zod';

/**
 * Sprint 5 — MT-1. DTOs Zod para los endpoints `branding`.
 *
 * Contrato publicado en `docs/sprint5/DISPATCH_PLAN.md` (consumers MT-2 / MT-3).
 *
 * Shape `BrandingResponseDto` se devuelve TANTO al insured (`GET /v1/tenants/me/branding`)
 * como al admin (`GET /v1/admin/tenants/:id/branding`). Mantener una sola
 * shape evita drift entre el editor admin y el portal del asegurado.
 *
 * Reglas:
 *   - Hex obligatorio en formato `#RRGGBB` (regex). Frontend valida WCAG AA
 *     contraste contra fondo (warning si falla); backend sólo enforza shape.
 *   - URLs son strings absolutas (`https://...`) o `null` (no relativas — el
 *     portal puede vivir en un dominio distinto al del CDN de branding y
 *     resolver una URL relativa contra `apps/portal` rompería los assets).
 *   - `displayName`: 1..80 chars (no permitido string vacío en update).
 *   - `tagline`: opcional, hasta 160 chars; string vacío → null.
 */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Valida hex `#RRGGBB`. Helper exportable para tests. */
export const HexColorSchema = z
  .string()
  .regex(HEX_RE, { message: 'Hex inválido. Formato esperado: #RRGGBB' });

/** URL absoluta opcional (acepta http/https). */
const AbsoluteUrlSchema = z
  .string()
  .url({ message: 'URL absoluta requerida (http/https).' })
  .max(512, { message: 'URL demasiado larga (>512 chars).' });

/**
 * Shape devuelta al cliente (insured y admin GET).
 *
 * IMPORTANTE: este shape es el contrato publicado para MT-2 / MT-3.
 * Cualquier cambio rompe el portal y el editor admin → coordinar primero
 * en `docs/sprint5/_features-feed.md`.
 */
export const BrandingResponseSchema = z.object({
  tenantId: z.string().uuid(),
  /** Nombre comercial visible. Fallback "SegurAsist" cuando el tenant no setea uno. */
  displayName: z.string().min(1).max(80),
  /** Tagline opcional bajo el logo. */
  tagline: z.string().max(160).nullable(),
  /** URL CloudFront del logo. Null → portal usa placeholder default. */
  logoUrl: AbsoluteUrlSchema.nullable(),
  /** Color primario `#RRGGBB`. */
  primaryHex: HexColorSchema,
  /** Color de acento `#RRGGBB`. */
  accentHex: HexColorSchema,
  /** URL CloudFront del bg image. Null → portal usa gradient default. */
  bgImageUrl: AbsoluteUrlSchema.nullable(),
  /** ISO 8601. Última modificación (mutación admin). Null → branding default no editado nunca. */
  lastUpdatedAt: z.string().datetime().nullable(),
});
export type BrandingResponseDto = z.infer<typeof BrandingResponseSchema>;

/**
 * Body del PUT admin (update branding). NO incluye `logoUrl` — la URL del
 * logo se setea via `POST /v1/admin/tenants/:id/branding/logo` (multipart) /
 * borra via DELETE. Esto evita que un admin pueda apuntar `logoUrl` a un
 * dominio externo (XSS / data exfiltration) en lugar del CDN gestionado.
 */
export const UpdateBrandingSchema = z.object({
  displayName: z.string().min(1).max(80),
  tagline: z
    .string()
    .max(160)
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v)),
  primaryHex: HexColorSchema,
  accentHex: HexColorSchema,
  /**
   * Bg image URL — opcional. Cuando se omite, NO modifica el valor existente
   * (delete explícito vía body con `null` no soportado iter 1; usar el flow
   * de logo `DELETE` cuando exista endpoint específico para bg image en
   * iter 2).
   */
  bgImageUrl: AbsoluteUrlSchema.optional(),
});
export type UpdateBrandingDto = z.infer<typeof UpdateBrandingSchema>;
