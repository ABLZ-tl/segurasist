/**
 * Wrapper de Puppeteer para generar PDFs desde HTML.
 *
 * Decisiones críticas:
 *  1. **Browser singleton warm-up**: arrancar Chromium cuesta ~500ms; lo
 *     dejamos vivo durante la vida del worker. Tradeoff: ~300MB RAM idle.
 *  2. **Dev macOS arm64**: usamos `puppeteer` full (descarga Chromium al
 *     install). NO `chrome-aws-lambda` — incompatible con arm64 nativo.
 *  3. **Prod (Sprint 5+)**: ADR documenta migrar a `@sparticuz/chromium`
 *     + `puppeteer-core` para Lambda. Mismo contrato, distinta dep.
 *  4. **Timeout 10s** por render; si excede se aborta y el caller marca
 *     el certificado como `failed` SIN retry automático (operator re-emite).
 *  5. **Args sandbox**: `--no-sandbox --disable-setuid-sandbox` requeridos
 *     en Docker / Lambda. `--disable-dev-shm-usage` evita fallos por
 *     `/dev/shm` chico (típico Docker default 64MB).
 *
 * Lazy: el browser NO se lanza en constructor — sólo cuando llega el primer
 * `render(...)`. Así, módulos que importan el provider pero nunca generan
 * PDFs (e.g. e2e de auth) no levantan Chromium.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';

export interface RenderPdfOpts {
  html: string;
  /** Nombre simbólico para logs (no se persiste). */
  ref?: string;
  /** Timeout ms; default 10000. */
  timeoutMs?: number;
  /** Formato de página, default 'A4'. */
  format?: 'A4' | 'Letter';
}

export interface RenderPdfResult {
  pdf: Buffer;
  /** ms gastados en goto+pdf (excluye warm-up). */
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

@Injectable()
export class PuppeteerService implements OnModuleDestroy {
  private readonly log = new Logger(PuppeteerService.name);
  private browser: Browser | null = null;
  private warmupPromise: Promise<Browser> | null = null;

  /**
   * Garantiza que el browser está vivo. Concurrencia segura: si dos calls
   * llegan antes de que termine el primer launch, comparten la misma promise.
   */
  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) return this.browser;
    if (this.warmupPromise) return this.warmupPromise;
    this.warmupPromise = puppeteer.launch({
      // Puppeteer 22+ ya usa el modo headless moderno por default cuando es true.
      // El antiguo string 'new' se removió del tipo. Sprint 5: cambiar a
      // puppeteer-core + @sparticuz/chromium para Lambda.
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      this.browser = await this.warmupPromise;
      this.log.log(`Puppeteer browser warm: pid=${this.browser.process()?.pid ?? 'n/a'}`);
      return this.browser;
    } finally {
      this.warmupPromise = null;
    }
  }

  /**
   * Renderiza HTML a PDF buffer. Si el render excede `timeoutMs`, lanza
   * `Error('PDF_RENDER_TIMEOUT')` — el caller debe persistir
   * `certificate.status=failed` y emitir `certificate.generation_failed`.
   *
   * Cada render usa una página NUEVA (descartable). Reusar página entre
   * renders sería ~30ms más rápido pero arrastra estado DOM/cookies que
   * podría leak entre tenants → no vale la pena.
   */
  async renderPdf(opts: RenderPdfOpts): Promise<RenderPdfResult> {
    const browser = await this.ensureBrowser();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();
    const page = await browser.newPage();
    try {
      await page.setContent(opts.html, { waitUntil: 'networkidle0', timeout: timeoutMs });
      const pdfBuffer = await page.pdf({
        format: opts.format ?? 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
        timeout: timeoutMs,
      });
      const durationMs = Date.now() - start;
      // page.pdf() en Puppeteer 22 devuelve Uint8Array; lo normalizamos a Buffer.
      const pdf = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
      return { pdf, durationMs };
    } catch (err) {
      const elapsed = Date.now() - start;
      if (elapsed >= timeoutMs - 100) {
        // Timeout: lanzamos error semántico para que el worker lo marque.
        throw new Error('PDF_RENDER_TIMEOUT');
      }
      throw err;
    } finally {
      try {
        await page.close();
      } catch {
        /* ignorar */
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        /* ignorar */
      }
      this.browser = null;
    }
  }
}
