/**
 * Sprint 5 — MT-1 (created) + MT-3 (consumer in `apps/portal/middleware.ts`).
 *
 * Helper para construir el `Content-Security-Policy` HTTP header de los
 * portales (admin / asegurado) con allow-list de hosts del CDN de tenant
 * branding (CloudFront).
 *
 * Por qué un helper compartido: ambos portales (admin + insured) deben
 * permitir cargar logos/bg images desde el bucket `segurasist-tenant-branding-{env}`
 * vía CloudFront. Sin esto, `img-src 'self'` bloquearía las imágenes y el
 * portal del asegurado mostraría broken-image en el header.
 *
 * NEW-FINDING para MT-3 (debe consumirse en iter 2 sin tocar este file):
 *   El portal `apps/portal/middleware.ts` debe llamar
 *   `buildPortalCsp({ tenantBrandingDomain: env.NEXT_PUBLIC_TENANT_BRANDING_DOMAIN, nonce })`
 *   y setear el header `Content-Security-Policy` resultante en la response.
 *   Domain por defecto sugerido: `branding-cdn.segurasist.app` o el output
 *   `cloudfront_domain_name` del módulo `s3-tenant-branding`. Coordinar con
 *   MT-3 el nombre exacto de la env var (NEXT_PUBLIC_*).
 *
 * IMPORTANTE — NO modificar `apps/portal/middleware.ts` desde MT-1: esa
 * file está en File Ownership de MT-3 (DISPATCH_PLAN.md). Este helper queda
 * publicado y MT-3 lo consume.
 */

export interface PortalCspOptions {
  /**
   * Dominio del CDN de branding (e.g. `branding-cdn.segurasist.app`,
   * `dxxxxxx.cloudfront.net`). Se permite via `img-src` y `connect-src`
   * (este último para que el editor admin pueda hacer `fetch` previews).
   * Si null/undefined, se permite el wildcard `*.cloudfront.net` como
   * fallback (cualquier distribución CloudFront — más laxo pero permite
   * deploy sin saber el subdomain exacto en boot del Next.js).
   */
  tenantBrandingDomain?: string | null;

  /**
   * Nonce (base64) que el handler genera por request para `style-src` /
   * `script-src 'nonce-{nonce}'`. Si null, el helper devuelve un CSP sin
   * nonces (modo strict para endpoints REST que jamás devuelven HTML).
   */
  nonce?: string | null;

  /**
   * Lista adicional de hosts permitidos (e.g. analytics, captcha). Se
   * agregan a `img-src` y `connect-src`.
   */
  extraImgHosts?: string[];
  extraConnectHosts?: string[];
}

/**
 * Construye el `Content-Security-Policy` header value para los portales
 * Next.js. Diseñado para `apps/admin` y `apps/portal` — la API REST usa
 * un CSP más estricto (`default-src 'none'`) configurado en `main.ts`.
 */
export function buildPortalCsp(opts: PortalCspOptions = {}): string {
  const branding = opts.tenantBrandingDomain
    ? [opts.tenantBrandingDomain.replace(/^https?:\/\//, '')]
    : ['*.cloudfront.net'];
  const imgHosts = ["'self'", 'data:', 'blob:', ...branding, ...(opts.extraImgHosts ?? [])];
  const connectHosts = ["'self'", ...branding, ...(opts.extraConnectHosts ?? [])];
  const styleSrc = opts.nonce
    ? ["'self'", `'nonce-${opts.nonce}'`, "'unsafe-inline'"]
    : ["'self'", "'unsafe-inline'"]; // unsafe-inline para tailwind utility CSS hash-based.
  const scriptSrc = opts.nonce ? ["'self'", `'nonce-${opts.nonce}'`] : ["'self'"];

  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['img-src', imgHosts],
    ['connect-src', connectHosts],
    ['style-src', styleSrc],
    ['script-src', scriptSrc],
    ['font-src', ["'self'", 'data:']],
    ['frame-ancestors', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'self'"]],
  ];

  return directives.map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}

/**
 * Helper específico para `img-src` — útil si MT-3 quiere componer el CSP
 * en otra forma (e.g. heredando un baseline de `next.config.js`).
 */
export function tenantBrandingImgSources(domain?: string | null): string[] {
  if (!domain) return ['*.cloudfront.net'];
  return [domain.replace(/^https?:\/\//, '')];
}
