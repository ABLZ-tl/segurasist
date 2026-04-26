/**
 * Resolver de plantillas de email. Análogo al `TemplateResolver` de
 * certificates pero para los `.hbs` de email (HTML + texto plano).
 *
 * MVP sólo tiene una plantilla (`certificate-issued`) en variantes html/txt.
 * Si el tenant tiene `brand.emailTemplate` definido, intentamos cargar
 * `<emailTemplate>.html.hbs` / `.txt.hbs`; si no existe, fallback a
 * `certificate-issued`.
 */
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import Handlebars from 'handlebars';

export type CompiledEmailTemplate = HandlebarsTemplateDelegate<Record<string, unknown>>;

export interface EmailTemplatePair {
  html: CompiledEmailTemplate;
  text: CompiledEmailTemplate;
  name: string;
}

const TEMPLATES_DIR = path.resolve(__dirname, 'templates');
const CACHE_TTL_MS = 5 * 60 * 1000;
const KNOWN: ReadonlySet<string> = new Set(['certificate-issued']);

interface CacheEntry {
  pair: EmailTemplatePair;
  expiresAt: number;
}

export class EmailTemplateResolver {
  private readonly cache = new Map<string, CacheEntry>();

  resolveTemplateName(input: { brand?: { emailTemplate?: string } | null }): string {
    const requested = input.brand?.emailTemplate;
    if (requested && KNOWN.has(requested)) return requested;
    return 'certificate-issued';
  }

  async loadForTenant(input: { brand?: { emailTemplate?: string } | null }): Promise<EmailTemplatePair> {
    const name = this.resolveTemplateName(input);
    return this.load(name);
  }

  async load(name: string): Promise<EmailTemplatePair> {
    if (!KNOWN.has(name)) {
      throw new Error(`EmailTemplateResolver: plantilla desconocida '${name}'`);
    }
    const now = Date.now();
    const hit = this.cache.get(name);
    if (hit && hit.expiresAt > now) return hit.pair;

    const htmlSrc = await readFile(path.join(TEMPLATES_DIR, `${name}.html.hbs`), 'utf8');
    const textSrc = await readFile(path.join(TEMPLATES_DIR, `${name}.txt.hbs`), 'utf8');
    const pair: EmailTemplatePair = {
      html: Handlebars.compile<Record<string, unknown>>(htmlSrc),
      text: Handlebars.compile<Record<string, unknown>>(textSrc),
      name,
    };
    this.cache.set(name, { pair, expiresAt: now + CACHE_TTL_MS });
    return pair;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
