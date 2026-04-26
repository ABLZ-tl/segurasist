import { defineConfig, devices } from '@playwright/test';

const ADMIN_URL = process.env['ADMIN_BASE_URL'] ?? 'http://localhost:3000';
const PORTAL_URL = process.env['PORTAL_BASE_URL'] ?? 'http://localhost:3001';

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
});
