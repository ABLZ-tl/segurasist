import { test, expect } from '@playwright/test';

test.skip('portal asegurado OTP flow with mocked backend', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/CURP/i).fill('CARM920101MDFRPN08');
  await page.getByRole('button', { name: /Enviar código/i }).click();
  await expect(page).toHaveURL(/\/otp/);
  await page.getByLabel(/Código de 6 dígitos/i).fill('123456');
  await page.getByRole('button', { name: /Verificar/i }).click();
  await expect(page).toHaveURL('/');
});
