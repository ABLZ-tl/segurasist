import { test, expect } from '@playwright/test';

test.skip('asegurado descarga su certificado en PDF', async ({ page }) => {
  await page.goto('/');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar mi certificado/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
});
