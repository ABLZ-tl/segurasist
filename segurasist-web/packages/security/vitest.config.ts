import { defineConfig } from 'vitest/config';

/**
 * Security-critical package. Coverage thresholds set to 80/75/80/80 per the
 * Sprint 4 fix plan (B-COOKIES-DRY) — cookies, origin enforcement and the
 * proxy factory are the single point where CSRF/SameSite hardening lives,
 * so regressions must be caught at unit level before integration.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      reporter: ['text-summary', 'text', 'html'],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 80,
        statements: 80,
      },
    },
  },
});
