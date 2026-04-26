import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * S1-09 — portal asegurado OTP flow.
 *
 * SKIP justificado (Sprint 1):
 *   `CognitoService.startInsuredOtp` y `verifyInsuredOtp` siguen siendo stubs
 *   que arrojan `NotImplementedException` (501). Verificación al 2026-04-26:
 *
 *     curl -sX POST http://localhost:3000/v1/auth/otp/request \
 *          -H 'content-type: application/json' \
 *          -d '{"curp":"PEPM800101HDFRRR03","channel":"email"}'
 *     → 501 NOT_IMPLEMENTED  ("CognitoService.startInsuredOtp")
 *
 *   Implementación pendiente para Sprint 3 (portal asegurado + dashboard).
 *
 * Plan de wireup cuando el endpoint exista:
 *   1. POST /v1/auth/otp/request con CURP de seed insured (PEPM800101HDFRRR03).
 *      → 202 Accepted; backend dispara CUSTOM_CHALLENGE en cognito-local que
 *        envía el código OTP por SES → mailpit (SMTP local).
 *   2. Polling a Mailpit API en `http://localhost:8025/api/v1/messages` para
 *      extraer el código OTP del último mensaje al CURP. Regex aproximada:
 *        /\b(\d{6})\b/  sobre el body.text del último Message.
 *   3. POST /v1/auth/otp/verify con `{ session, code }` → 200 con tokens
 *      (idToken/accessToken/refreshToken) en el body.
 *   4. El portal Next.js mirroreará los cookies httpOnly via su propio proxy
 *      `/api/auth/local-login-otp`; navegar a `/` y esperar el badge VIGENTE
 *      de la tarjeta del asegurado.
 *
 * Cuando se desbloquee borrar el `test.skip` y reemplazar por el flujo real.
 */
test.skip('portal asegurado OTP via Mailpit (pendiente Sprint 3 — startInsuredOtp/verifyInsuredOtp)', async ({
  page,
  request,
}) => {
  // Smoke: verificar que el endpoint dejó de devolver 501.
  const probe = await request.post('http://localhost:3000/v1/auth/otp/request', {
    data: { curp: 'PEPM800101HDFRRR03', channel: 'email' },
    failOnStatusCode: false,
  });
  expect(probe.status()).not.toBe(501);

  // Flujo real (cuando esté implementado):
  await page.goto('/login');
  await page.getByLabel(/CURP/i).fill('PEPM800101HDFRRR03');
  await page.getByRole('button', { name: /Enviar c[oó]digo/i }).click();
  await expect(page).toHaveURL(/\/otp/);

  // Polling a Mailpit
  const otpCode = await pollMailpitForOtp(request, /\b(\d{6})\b/, 30_000);
  await page.getByLabel(/C[oó]digo de 6 d[ií]gitos/i).fill(otpCode);
  await page.getByRole('button', { name: /Verificar/i }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText(/VIGENTE/i)).toBeVisible();
});

/**
 * Helper para poll de Mailpit. Reservado para cuando OTP esté implementado.
 * @internal
 */
async function pollMailpitForOtp(
  request: APIRequestContext,
  pattern: RegExp,
  timeoutMs: number,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request.get('http://localhost:8025/api/v1/messages');
    if (res.ok()) {
      const body = (await res.json()) as { messages?: Array<{ ID: string }> };
      const last = body.messages?.[0];
      if (last) {
        const detail = await request.get(`http://localhost:8025/api/v1/message/${last.ID}`);
        if (detail.ok()) {
          const data = (await detail.json()) as { Text?: string };
          const m = pattern.exec(data.Text ?? '');
          if (m && m[1]) return m[1];
        }
      }
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error('OTP code not received in Mailpit within timeout');
}
