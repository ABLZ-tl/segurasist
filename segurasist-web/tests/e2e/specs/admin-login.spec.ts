import { test, expect } from '@playwright/test';

// Skipped: requires Cognito credentials and running backend. Wire up when CI
// has secrets and a seeded test user.
test.skip('admin SSO login redirects through Cognito and lands on /dashboard', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /Iniciar sesión con MAC SSO/i })).toBeVisible();
  // Click would navigate off-domain; intercept and stub when we have a Hosted UI mock.
});
