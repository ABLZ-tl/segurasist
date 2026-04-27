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
      include: [
        'app/**/*.{ts,tsx}',
        'lib/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
      ],
      exclude: ['**/*.d.ts', '**/*.stories.{ts,tsx}', '**/*.test.{ts,tsx}'],
      reporter: ['text-summary', 'text', 'html'],
    },
  },
});
