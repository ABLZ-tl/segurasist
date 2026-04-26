/**
 * Admin app Next.js config.
 *
 * Security headers per spec §6.2:
 *  - CSP: locked to self + Cognito + the SegurAsist API.
 *  - HSTS: 2 years, preload-eligible.
 *  - X-Frame-Options DENY + COOP/COEP for cross-origin isolation.
 *  - Permissions-Policy disables device APIs we never use.
 *
 * `transpilePackages` is required so Next compiles our workspace TS sources
 * (we publish raw .ts/.tsx, not built bundles).
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
    const isDev = process.env.NODE_ENV !== 'production';
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
    const connectSrc = isDev
      ? "connect-src 'self' http://localhost:3000 ws://localhost:3001 https://api.segurasist.app https://cognito-idp.mx-central-1.amazonaws.com"
      : "connect-src 'self' https://api.segurasist.app https://cognito-idp.mx-central-1.amazonaws.com";

    const csp = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://*.amazonaws.com",
      "font-src 'self' data:",
      connectSrc,
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
