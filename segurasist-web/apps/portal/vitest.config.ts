import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Portal vitest config.
 *
 * - jsdom para que `@testing-library/react` pueda montar componentes.
 * - Resolver `@/*` igual que tsconfig (apps/portal raíz).
 * - `globals: true` evita importar `describe`/`it` en cada archivo.
 * - `setupFiles` carga matchers de jest-dom + mocks de Next.
 * - `server-only` se mapea a un stub vacío para que los módulos server-side
 *   importados desde tests jsdom no exploten.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      'server-only': resolve(__dirname, 'test/stubs/empty.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    include: ['{app,lib,components,test}/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: [
        'app/**/*.{ts,tsx}',
        'lib/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
      ],
      exclude: [
        '**/*.d.ts',
        '**/*.stories.{ts,tsx}',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/types/**',
        '**/types.ts',
        'app/layout.tsx',
        'app/(auth)/layout.tsx',
        'app/(app)/layout.tsx',
        'app/api/proxy/[...path]/route.ts',
      ],
      reporter: ['text-summary', 'text', 'html'],
      // H-21 (Sprint 4) — threshold real para portal. Sin esto, el
      // pipeline pasaba aunque la cobertura fuera 0%. Empezamos en
      // 60/55/60/60 igual que admin para nivelar la barra.
      thresholds: {
        statements: 60,
        branches: 55,
        functions: 60,
        lines: 60,
      },
    },
  },
});
