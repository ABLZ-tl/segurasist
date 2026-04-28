/**
 * CSP `frame-src` integration test — Sprint 4 fix H-05.
 *
 * Por qué existe este test:
 *   El portal monta un <iframe> con la URL firmada del PDF del certificado.
 *   En CSP estricto, si NO declaras `frame-src` la directiva cae a
 *   `default-src 'self'` y el iframe queda en blanco en producción cuando
 *   la URL apunta a `*.s3.mx-central-1.amazonaws.com` o `*.cloudfront.net`.
 *   El bug es invisible en dev (default-src 'self' funciona porque el iframe
 *   carga del mismo origen) y aparece sólo en prod tras subir el PDF a S3.
 *
 * Estrategia: importar `next.config.mjs` directo, ejecutar el `headers()`
 * exportado, leer la línea de CSP y assertar que `frame-src` está presente
 * y permite los dominios de almacenamiento de PDFs. NO levantamos un
 * servidor Next — el config es la fuente de verdad y testearlo a ese nivel
 * desacopla el test de la versión de Next y del runtime jsdom.
 */
import { describe, expect, it } from 'vitest';
// next.config.mjs es ESM puro y exporta el config como default. Lo cargamos
// con import dinámico para que vitest aplique el resolver del workspace.
// El path es relativo al `apps/portal/` raíz porque el include de vitest
// resuelve desde ahí.
import portalConfig from '../../next.config.mjs';
import adminConfig from '../../../admin/next.config.mjs';

interface NextHeader {
  key: string;
  value: string;
}
interface NextHeaderRule {
  source: string;
  headers: NextHeader[];
}
interface NextConfigShape {
  headers: () => Promise<NextHeaderRule[]>;
}

async function getCsp(config: NextConfigShape): Promise<string> {
  const rules = await config.headers();
  const cspHeader = rules
    .flatMap((r) => r.headers)
    .find((h) => h.key === 'Content-Security-Policy');
  if (!cspHeader) throw new Error('CSP header not declared in config');
  return cspHeader.value;
}

describe('Portal CSP — frame-src directive (H-05)', () => {
  it('declares an explicit frame-src directive', async () => {
    const csp = await getCsp(portalConfig as NextConfigShape);
    expect(csp).toMatch(/frame-src\s+/);
  });

  it('frame-src allows S3 mx-central-1 (signed PDF URLs)', async () => {
    const csp = await getCsp(portalConfig as NextConfigShape);
    // Match `frame-src` segment — tolera spacing y orden de tokens.
    const seg = /frame-src[^;]*/.exec(csp)?.[0] ?? '';
    expect(seg).toMatch(/https:\/\/\*\.s3\.mx-central-1\.amazonaws\.com/);
  });

  it('frame-src allows CloudFront (CDN-fronted PDFs)', async () => {
    const csp = await getCsp(portalConfig as NextConfigShape);
    const seg = /frame-src[^;]*/.exec(csp)?.[0] ?? '';
    expect(seg).toMatch(/https:\/\/\*\.cloudfront\.net/);
  });

  it("frame-src includes 'self' for same-origin previews", async () => {
    const csp = await getCsp(portalConfig as NextConfigShape);
    const seg = /frame-src[^;]*/.exec(csp)?.[0] ?? '';
    expect(seg).toMatch(/'self'/);
  });

  it("keeps frame-ancestors 'none' (anti-clickjacking) — orthogonal to frame-src", async () => {
    const csp = await getCsp(portalConfig as NextConfigShape);
    expect(csp).toMatch(/frame-ancestors\s+'none'/);
  });
});

describe('Admin CSP — frame-src directive (H-05b preventiva)', () => {
  it('admin also declares frame-src to mirror portal envelope', async () => {
    const csp = await getCsp(adminConfig as NextConfigShape);
    expect(csp).toMatch(/frame-src\s+/);
    const seg = /frame-src[^;]*/.exec(csp)?.[0] ?? '';
    expect(seg).toMatch(/https:\/\/\*\.s3\.mx-central-1\.amazonaws\.com/);
    expect(seg).toMatch(/https:\/\/\*\.cloudfront\.net/);
  });
});
