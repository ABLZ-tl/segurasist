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
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://*.amazonaws.com",
      "font-src 'self' data:",
      "connect-src 'self' https://api.segurasist.app https://cognito-idp.mx-central-1.amazonaws.com",
      "frame-src 'self' https://*.s3.mx-central-1.amazonaws.com https://*.cloudfront.net",
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
