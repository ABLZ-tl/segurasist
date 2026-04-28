import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      reporter: ['text-summary', 'text', 'html'],
      // H-21 (Sprint 4) — packages/auth es security-critical (cookies,
      // JWT verify, session refresh). El threshold es deliberadamente
      // más alto que el resto del workspace para evitar regresiones
      // silentes en el envelope CSRF/sessions consolidado por F7.
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
});
