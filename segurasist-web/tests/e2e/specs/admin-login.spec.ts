import { test, expect } from '@playwright/test';

/**
 * S1-09 — admin login E2E (real, not skipped).
 *
 * Pre-requisitos para que estos tests pasen:
 *   1. Stack docker-compose corriendo:
 *        cd segurasist-api && docker compose up -d
 *      (postgres, redis, localstack, mailpit, cognito-local)
 *   2. Bootstrap cognito-local con el seed admin:
 *        cd segurasist-api && bash scripts/cognito-local-bootstrap.sh
 *      (crea user `admin@mac.local` / `Admin123!` con custom:tenant_id).
 *   3. API NestJS:
 *        cd segurasist-api && npm run dev   (escucha en :3000)
 *   4. Admin Next.js:
 *        cd segurasist-web && pnpm --filter @segurasist/admin dev   (escucha en :3001)
 *
 * Coordinación con otros agentes:
 * - El proxy /api/auth/local-login se está endureciendo (sameSite + Origin allowlist
 *   + secure flag). Estos tests usan Playwright `request` directamente cuando precisan
 *   tokens fuera del browser, y para la UI el flujo normal del browser ya envía el
 *   header `Origin: http://localhost:3001` que la allowlist debe aceptar.
 * - Hay rate limiting (5 req/min en /v1/auth/login). Cada test usa UN sólo intento
 *   con credenciales correctas. Si al re-correr en local hay flakiness por 429, esperar
 *   60s antes de reintentar.
 * - El AuditInterceptor persistirá una fila por cada login OK; no afecta las aserciones.
 */

test.describe('admin login', () => {
  // El primer hit en dev compila /login, /dashboard y /api/auth/local-login on-demand;
  // los tests del describe usan un timeout amplio para tolerarlo.
  test.setTimeout(120_000);

  test('admin login con credenciales válidas redirige a /dashboard', async ({ page }) => {
    // Captura logs de consola del browser para diagnóstico cuando el flow falla.
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    // En el primer hit a /login el dev server compila la ruta on-demand (15–30s);
    // usar `networkidle` permite esperar hasta que el bundle terminó de cargar.
    await page.goto('/login', { waitUntil: 'networkidle', timeout: 60_000 });
    // El form vive dentro de un <Suspense> por `useSearchParams()`; esperamos
    // hidratación con timeout generoso por si el dev server aún compila.
    await expect(page.getByRole('heading', { name: /Inicia sesi[oó]n/i })).toBeVisible({
      timeout: 30_000,
    });

    const emailInput = page.getByLabel(/Correo/i);
    await emailInput.waitFor({ state: 'visible' });
    await emailInput.fill('admin@mac.local');
    await page.getByLabel(/Contraseña/i).fill('Admin123!');

    // Capturar la respuesta del login. El form invoca `/api/auth/local-login`
    // mediante fetch() desde el componente cliente.
    const [loginResp] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/auth/local-login') && resp.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      page.getByRole('button', { name: /Continuar/i }).click(),
    ]);

    expect(
      loginResp.status(),
      `local-login proxy returned ${loginResp.status()}. Console errors: ${consoleErrors.join(' | ')}`,
    ).toBe(200);

    await page.waitForURL('**/dashboard', { timeout: 30_000 });
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText('admin@mac.local')).toBeVisible();
  });

  test('admin login con password inválida muestra error', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle', timeout: 60_000 });
    // Esperar que el form esté hidratado antes de interactuar.
    await expect(page.getByRole('heading', { name: /Inicia sesi[oó]n/i })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByLabel(/Correo/i).fill('admin@mac.local');
    await page.getByLabel(/Contraseña/i).fill('wrong-password-xyz');
    await page.getByRole('button', { name: /Continuar/i }).click();

    // El AlertBanner muestra "No pudimos iniciar sesión" + detail
    // "Credenciales incorrectas. Verifica tu correo y contraseña."
    await expect(page.getByText(/Credenciales incorrectas/i)).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/login(\?.*)?$/);
  });

  test('acceder a /dashboard sin sesión redirige a /login con next param', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/dashboard');
    await page.waitForURL('**/login**', { timeout: 5_000 });
    // El middleware admin (devMiddleware) construye `?next=<pathname>` y Next.js
    // lo URL-encodea: `/login?next=%2Fdashboard`.
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  });
});
