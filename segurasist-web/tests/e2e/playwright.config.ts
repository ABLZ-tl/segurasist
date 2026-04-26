import { defineConfig, devices } from '@playwright/test';

const ADMIN_URL = process.env['ADMIN_BASE_URL'] ?? 'http://localhost:3001';
const PORTAL_URL = process.env['PORTAL_BASE_URL'] ?? 'http://localhost:3002';

/**
 * Playwright config para E2E SegurAsist.
 *
 * Asume que el stack docker-compose y las apps Next.js están corriendo:
 *   - admin Next.js  → :3001
 *   - portal Next.js → :3002
 *   - API NestJS     → :3000
 *   - cognito-local  → :9229
 *   - mailpit        → :8025
 *
 * Si las apps no están corriendo Playwright las arranca via `webServer`
 * (reuseExistingServer = true → NoOp si ya están). Ver tests/e2e/README.md
 * para el procedimiento manual recomendado.
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'admin-chromium',
      use: { ...devices['Desktop Chrome'], baseURL: ADMIN_URL },
      testMatch: /admin-.*\.spec\.ts/,
    },
    {
      name: 'portal-mobile',
      use: { ...devices['iPhone 13'], baseURL: PORTAL_URL },
      testMatch: /portal-.*\.spec\.ts/,
    },
  ],
  webServer: process.env['PLAYWRIGHT_NO_WEBSERVER']
    ? undefined
    : [
        {
          // Admin: si ya está corriendo, reusarlo. Si no, lanzarlo.
          command: 'pnpm --filter @segurasist/admin dev',
          url: ADMIN_URL,
          cwd: '../..',
          timeout: 120_000,
          reuseExistingServer: true,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          command: 'pnpm --filter @segurasist/portal dev',
          url: PORTAL_URL,
          cwd: '../..',
          timeout: 120_000,
          reuseExistingServer: true,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      ],
});
