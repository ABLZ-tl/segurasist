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
      // H-20 (Sprint 4) — anteriormente este bloque enumeraba archivos
      // manualmente con `include`, lo que excluía silenciosamente los
      // archivos donde el audit detectó findings High (mobile-drawer,
      // proxy passthrough, NextAuth catch-all, layout.tsx) y dejaba
      // los thresholds 80/75/80/80 como máscara cosmética.
      //
      // Ahora cobramos TODO `app/**`, `lib/**` y `components/**` y
      // declaramos exclusiones por carpeta/funcionalidad concreta. Los
      // umbrales bajan a 60/55/60/60 reales — ver decisión en sección 10
      // del AUDIT_INDEX (ramp a 70/65 en Sprint 5).
      include: [
        'app/**/*.{ts,tsx}',
        'lib/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
      ],
      exclude: [
        '**/*.d.ts',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/*.stories.{ts,tsx}',
        // Tipos puros y constantes — sin lógica ejecutable.
        '**/types/**',
        '**/types.ts',
        // Server Components que solo renderizan markup estático con next/font;
        // no aportan branches útiles a coverage.
        'app/layout.tsx',
        'app/(auth)/layout.tsx',
        'app/(app)/layout.tsx',
        // Catch-all proxies y NextAuth handlers se cubren con e2e/integration
        // (tests/portal: csp-iframe, tests/api: superadmin-cross-tenant).
        'app/api/auth/[...nextauth]/route.ts',
        'app/api/proxy/[...path]/route.ts',
      ],
      thresholds: {
        statements: 60,
        branches: 55,
        functions: 60,
        lines: 60,
      },
    },
  },
});
