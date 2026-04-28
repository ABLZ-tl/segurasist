import { defineConfig } from 'vitest/config';

/**
 * H-21 + H-28 (Sprint 4) — vitest config para `@segurasist/api-client`.
 *
 * Antes el package corría `vitest run --passWithNoTests`, lo que hacía que
 * los 26 hooks que consume el portal/admin pasaran sin un solo test. Ahora
 * cubrimos los hooks principales (insureds, batches, certificates, claims,
 * coverages, exports, dashboard, packages, auth) con tests reales que
 * mockean `fetch` y verifican path + verbo + body, plus un threshold real
 * 60/55/60/60.
 *
 * Environment: jsdom porque el `client.ts` usa `crypto.randomUUID()` y
 * `typeof window !== 'undefined'`. Los tests no montan React per se: usan
 * `renderHook` desde `@testing-library/react` con un `QueryClientProvider`
 * minimal — esto requiere DOM.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/index.ts',
        'src/types.ts',
        'src/generated/**',
      ],
      reporter: ['text-summary', 'text', 'html'],
      thresholds: {
        statements: 60,
        branches: 55,
        functions: 60,
        lines: 60,
      },
    },
  },
});
