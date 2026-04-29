/**
 * Portal asegurado Next.js config — same security envelope as admin (§6.2),
 * plus stricter performance budgets enforced by the Lighthouse CI step.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    '@segurasist/ui',
    '@segurasist/api-client',
    '@segurasist/auth',
    '@segurasist/i18n',
  ],
  experimental: {
    typedRoutes: true,
  },
  async headers() {
    // H-05: el preview del certificado se monta en un <iframe> que carga la
    // URL firmada del PDF (S3 presigned o CloudFront). Sin `frame-src` la
    // directiva cae a `default-src 'self'` y el iframe queda en blanco en
    // prod. Permitimos S3 mx-central-1 y CloudFront — ambos proyectados por
    // la infra. `frame-ancestors 'none'` sigue protegiendo al portal de ser
    // embebido por terceros (clickjacking) — son directivas ortogonales.
    //
    // Dev — `'unsafe-eval'` en script-src + localhost en connect-src son
    // necesarios para que Next.js dev runtime (React Refresh / HMR) funcione.
    // Sin esto el bundle main-app.js falla a evaluar, React no hidrata y la
    // página queda blanca. En prod NO se incluyen — el bundle ya está pre-built.
    const isDev = process.env.NODE_ENV !== 'production';
    // Sprint 5 / MT-3: tenant branding logos viajan por CloudFront. El
    // dominio exacto lo confirma MT-1 cuando publique la infra módulo
    // `s3-tenant-branding`; mientras tanto permitimos `*.cloudfront.net`
    // (igual que frame-src). Si el cliente exige dominio dedicado se
    // override vía env `NEXT_PUBLIC_BRANDING_CDN`.
    const brandingCdn = process.env.NEXT_PUBLIC_BRANDING_CDN ?? 'https://*.cloudfront.net';
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
    const connectSrc = isDev
      ? "connect-src 'self' http://localhost:3000 ws://localhost:3002 https://api.segurasist.app https://cognito-idp.mx-central-1.amazonaws.com"
      : "connect-src 'self' https://api.segurasist.app https://cognito-idp.mx-central-1.amazonaws.com";
    // Dev — preview de certificado se sirve desde LocalStack S3 (localhost:4566).
    // Sin este allowlist el iframe queda bloqueado por CSP frame-src.
    const frameSrc = isDev
      ? "frame-src 'self' http://localhost:4566 https://*.s3.mx-central-1.amazonaws.com https://*.cloudfront.net"
      : "frame-src 'self' https://*.s3.mx-central-1.amazonaws.com https://*.cloudfront.net";
    // Sprint 5 — `img-src` ahora incluye el CDN de branding tenant para que
    // `<img src={logoUrl}>` y `background-image: var(--tenant-logo-url)`
    // del `<TenantProvider>` carguen sin bloqueo CSP.
    const imgSrc = isDev
      ? `img-src 'self' data: http://localhost:4566 https://*.amazonaws.com ${brandingCdn}`
      : `img-src 'self' data: https://*.amazonaws.com ${brandingCdn}`;

    const csp = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      imgSrc,
      "font-src 'self' data:",
      connectSrc,
      frameSrc,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://*.amazoncognito.com",
      'upgrade-insecure-requests',
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
    ];
  },
};

export default nextConfig;
