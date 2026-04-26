/**
 * Resuelve la plantilla Handlebars correspondiente a un tenant para generar
 * el certificado PDF.
 *
 * Reglas:
 *  1. Si el `tenant.brandJson.template` apunta a una plantilla conocida
 *     (`mac`, `default`), usar esa.
 *  2. Si el slug del tenant matchea una plantilla por convención
 *     (`mac` → `mac.hbs`), usar esa.
 *  3. Fallback a `default.hbs`.
 *
 * Cache LRU TTL 5min: las plantillas son archivos en disco; reload por
 * llamada penalizaría latencia (~1ms compile Handlebars + IO). El TTL es
 * compromiso entre invalidación rápida en dev (rebuild template) y zero
 * overhead en prod.
 *
 * NOTA: no usamos LRU-cache lib externa para no agregar deps; un Map con
 * timestamp por entry es suficiente para el universo de tenants real (<100).
 */
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import Handlebars from 'handlebars';

export type CompiledTemplate = HandlebarsTemplateDelegate<Record<string, unknown>>;

export interface TenantBrand {
  template?: string;
  logo?: string;
  colors?: { primary?: string; accent?: string };
  legal?: string;
  emailFrom?: string;
  supportEmail?: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  compiled: CompiledTemplate;
  expiresAt: number;
}

const KNOWN_TEMPLATES = new Set(['default', 'mac']);
/** Templates dir resuelve relativo al archivo TS (en runtime: dist/.../templates). */
const TEMPLATES_DIR = path.resolve(__dirname, 'templates');

export class TemplateResolver {
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Resuelve el nombre de plantilla a usar (sin extensión). Visible para
   * tests y para el resolver de email (que sigue un patrón análogo).
   */
  resolveTemplateName(input: { tenantSlug?: string; brand?: TenantBrand | null }): string {
    const requested = input.brand?.template;
    if (requested && KNOWN_TEMPLATES.has(requested)) return requested;
    if (input.tenantSlug && KNOWN_TEMPLATES.has(input.tenantSlug)) return input.tenantSlug;
    return 'default';
  }

  /**
   * Compila (o devuelve cache) la plantilla. `force=true` ignora cache —
   * útil en dev cuando se editan los .hbs sin reiniciar el worker.
   */
  async load(name: string, force = false): Promise<CompiledTemplate> {
    if (!KNOWN_TEMPLATES.has(name)) {
      throw new Error(`TemplateResolver: plantilla desconocida '${name}'`);
    }
    const now = Date.now();
    if (!force) {
      const hit = this.cache.get(name);
      if (hit && hit.expiresAt > now) return hit.compiled;
    }
    const file = path.join(TEMPLATES_DIR, `${name}.hbs`);
    const source = await readFile(file, 'utf8');
    const compiled = Handlebars.compile<Record<string, unknown>>(source, { noEscape: false });
    this.cache.set(name, { compiled, expiresAt: now + CACHE_TTL_MS });
    return compiled;
  }

  /** Limpia cache (test-only). */
  clearCache(): void {
    this.cache.clear();
  }

  /** Atajo: resuelve nombre + carga compilada en una sola llamada. */
  async loadForTenant(input: { tenantSlug?: string; brand?: TenantBrand | null }): Promise<{
    name: string;
    template: CompiledTemplate;
  }> {
    const name = this.resolveTemplateName(input);
    const template = await this.load(name);
    return { name, template };
  }
}
