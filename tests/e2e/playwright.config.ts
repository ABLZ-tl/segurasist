import { defineConfig, devices } from '@playwright/test';

const ADMIN_URL = process.env['ADMIN_BASE_URL'] ?? 'http://localhost:3001';
const PORTAL_URL = process.env['PORTAL_BASE_URL'] ?? 'http://localhost:3002';

/**
 * Playwright config Sprint 5 — root-level.
 *
 * **Por qué un config separado** (vs. el de `segurasist-web/tests/e2e/`):
 *   - El config de segurasist-web cubre admin-login + portal-otp (Sprint 1).
 *   - Sprint 5 introduce flows multi-tenant (cross-leak + branding roundtrip
 *     + visual regression) que cruzan apps (admin + portal en paralelo) y
 *     necesitan un viewport consistente desktop. Mantener separado evita
 *     romper el grouping ya productivo.
 *   - Permite ejecutar Sprint 5 E2E desde la raíz del monorepo sin pisar
 *     los reportes del config existente.
 *
 * **Layout**:
 *   tests/e2e/playwright.config.ts   ← este file (sprint5)
 *   tests/e2e/multi-tenant-portal.spec.ts
 *   tests/e2e/admin-branding-roundtrip.spec.ts
 *   tests/visual-regression/portal-tenant-a.spec.ts
 *   tests/e2e/reports/sprint5-{ts}/  ← runner.sh exporta acá
 *
 * **No webServer**: este config asume que las apps ya corren (admin :3001,
 * portal :3002, API :3000, mailpit :8025, cognito-local :9229). El runner
 * `multi-tenant-portal.run.sh` muestra cómo lanzarlas. Si quieres que
 * Playwright los arranque, exporta `PLAYWRIGHT_AUTOSTART=1` y reusa el config
 * de `segurasist-web/tests/e2e/playwright.config.ts`.
 */
export default defineConfig({
  testDir: '..',
  fullyParallel: false, // los flujos multi-tenant tocan estado compartido (branding).
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1, // serialize para evitar carreras en branding update + cleanup.
  reporter: process.env['CI']
    ? [['github'], ['html', { open: 'never', outputFolder: 'reports/html' }], ['list']]
    : 'list',
  outputDir: './reports/test-results',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'sprint5-multi-tenant',
      use: { ...devices['Desktop Chrome'], baseURL: PORTAL_URL },
      testMatch: /e2e\/(multi-tenant-portal|admin-branding-roundtrip)\.spec\.ts$/,
    },
    {
      name: 'visual-regression',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: PORTAL_URL,
        viewport: { width: 1280, height: 800 },
      },
      testMatch: /visual-regression\/.*\.spec\.ts$/,
    },
  ],
  // expect global thresholds — los specs específicos pueden override.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      // Tolera anti-aliasing (border-radius dinámico, cursor focus).
      threshold: 0.15,
    },
  },
});

// Re-export for tooling (`tsx` / type-checks de scripts).
export { ADMIN_URL, PORTAL_URL };
