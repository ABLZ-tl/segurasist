import { test, expect } from '@playwright/test';

/**
 * S1-09 — portal asegurado descarga de certificado PDF.
 *
 * SKIP justificado (Sprint 1):
 *   La descarga de certificado requiere una sesión de `insured` activa, que se
 *   construye sólo a través del flujo OTP (CognitoService.startInsuredOtp /
 *   verifyInsuredOtp). Ambos siguen como stubs que devuelven 501 — ver
 *   `portal-otp.spec.ts` para la verificación al 2026-04-26.
 *
 *   Construir una sesión sintética via `AdminInitiateAuthCommand` contra el
 *   pool de insured no es viable hoy: cognito-local no firma correctamente los
 *   IdToken con `custom:role=insured` + `custom:tenant_id` para ese pool en el
 *   bootstrap actual (sólo el pool admin tiene admin auth flow habilitado), y
 *   además el endpoint backend de descarga (S2/S3) tampoco existe aún.
 *
 *   Implementación pendiente para Sprint 3 (portal asegurado) + Sprint 2
 *   (emisión de certificados). Cuando ambos estén listos:
 *     1. Login real via OTP (helper compartido con portal-otp.spec.ts).
 *     2. Click en "Descargar mi certificado".
 *     3. Esperar evento `download` y validar `suggestedFilename()` ~ /\.pdf$/.
 *     4. Validar primer byte = `%PDF` leyendo `download.path()`.
 */
test.skip('asegurado autenticado descarga su certificado en PDF (pendiente Sprint 3)', async ({
  page,
}) => {
  // Pre-condición: sesión de insured establecida via helper OTP (no implementado aún).
  await page.goto('/');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar mi certificado/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
});
