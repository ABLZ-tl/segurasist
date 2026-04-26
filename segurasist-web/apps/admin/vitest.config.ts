import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Vitest config for the admin Next.js app.
 *
 * - `jsdom` environment so React Testing Library can mount components.
 * - `globals: true` mirrors the `@segurasist/ui` package so tests don't
 *   need explicit `vi`/`expect`/`it` imports.
 * - `setupFiles` wires `@testing-library/jest-dom` matchers and the Next.js
 *   navigation/headers/font mocks.
 * - The `@/*` alias mirrors the tsconfig so imports inside the app resolve
 *   identically inside Vitest.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // `server-only` ships from Next.js to fail-fast in client bundles.
      // In Vitest we map it to an empty stub so server modules can be
      // imported under jsdom without crashing at import time.
      'server-only': path.resolve(__dirname, 'test/stubs/empty.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    css: false,
    include: ['{app,lib,test}/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Only files exercised by the unit suite — out-of-scope client-only
      // wrappers (mobile drawer, proxy passthrough, NextAuth catch-all) live
      // behind e2e and are intentionally excluded from this report.
      include: [
        'lib/rbac.ts',
        'lib/auth-server.ts',
        'lib/jwt.ts',
        'app/_components/access-denied.tsx',
        'app/_components/command-palette.tsx',
        'app/_components/sidebar-nav.tsx',
        'app/_components/theme-toggle.tsx',
        'app/api/auth/local-login/route.ts',
        'app/api/auth/me/route.ts',
        'app/(auth)/login/page.tsx',
      ],
      exclude: [
        '**/*.d.ts',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
});
