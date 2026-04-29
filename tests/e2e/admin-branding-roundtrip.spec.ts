import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Sprint 5 — MT-4 — E2E admin → portal branding propagation roundtrip.
 *
 * Objetivo: el admin de un tenant A cambia `primaryHex` desde
 * `/settings/branding`, hace save → toast OK → un asegurado del mismo tenant
 * que abre el portal en otra pestaña ve el color nuevo en CSS var
 * `--tenant-primary` (carga inicial / SWR cache 5min según DISPATCH_PLAN §5).
 *
 * **Cleanup**: el spec restaura el primaryHex original al final (incluso si
 * falla a mitad — `test.afterEach`).
 *
 * **Pre-requisitos**:
 *   - Admin pool: `admin@mac.local` / `Admin123!` (cred-doc commit `87da1cf`).
 *   - Insured pool: `HEGM860519MJCRRN08` (María).
 *   - MT-2 entrega `/settings/branding` con form (color picker primary +
 *     botón "Guardar").
 *   - MT-1 entrega `PUT /v1/admin/tenants/:id/branding`.
 *   - MT-3 entrega TenantBrandingProvider que aplica `--tenant-primary`.
 *
 * **Estado iter 1** — `it.skip` con motivo
 * `blocked-by: MT-1 + MT-2 + MT-3 entrega de iter 1`. Quitar skip en iter 2.
 */

const ADMIN_URL = process.env['ADMIN_BASE_URL'] ?? 'http://localhost:3001';
const PORTAL_URL = process.env['PORTAL_BASE_URL'] ?? 'http://localhost:3002';

const ORIGINAL_PRIMARY = '#16a34a';
const NEW_PRIMARY = '#0ea5e9';

const ADMIN_EMAIL = 'admin@mac.local';
const ADMIN_PASSWORD = 'Admin123!';
const INSURED_CURP = 'HEGM860519MJCRRN08';
const INSURED_EMAIL = 'insured.demo@mac.local';

async function loginAdmin(page: Page): Promise<void> {
  await page.goto(`${ADMIN_URL}/login`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.getByLabel(/Correo/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/Contraseña/i).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /Continuar/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
}

async function setBrandingPrimary(page: Page, hex: string): Promise<void> {
  await page.goto(`${ADMIN_URL}/settings/branding`, { waitUntil: 'networkidle' });
  // Color picker MT-2 expone input[type=color] + input[type=text] sincronizados.
  const colorText = page.getByLabel(/Color primario/i).first();
  await colorText.fill(hex);
  await page.getByRole('button', { name: /Guardar/i }).click();
  // Toast success de MT-2.
  await expect(page.getByText(/(Branding actualizado|Cambios guardados)/i)).toBeVisible({
    timeout: 10_000,
  });
}

async function loginInsuredOtp(page: Page, request: APIRequestContext): Promise<void> {
  await page.goto(`${PORTAL_URL}/login`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.getByLabel(/CURP/i).fill(INSURED_CURP);
  await page.getByRole('button', { name: /Enviar c[oó]digo/i }).click();
  await expect(page).toHaveURL(/\/otp/, { timeout: 15_000 });

  // Mailpit poll (filtro por destinatario).
  const start = Date.now();
  let code: string | null = null;
  while (Date.now() - start < 30_000) {
    const res = await request.get(
      'http://localhost:8025/api/v1/messages?query=' + encodeURIComponent(`to:${INSURED_EMAIL}`),
    );
    if (res.ok()) {
      const body = (await res.json()) as { messages?: Array<{ ID: string }> };
      const last = body.messages?.[0];
      if (last) {
        const detail = await request.get(`http://localhost:8025/api/v1/message/${last.ID}`);
        const data = (await detail.json()) as { Text?: string };
        const m = /\b(\d{6})\b/.exec(data.Text ?? '');
        if (m && m[1]) {
          code = m[1];
          break;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  if (!code) throw new Error('OTP no llegó a Mailpit');

  await page.getByLabel(/C[oó]digo de 6 d[ií]gitos/i).fill(code);
  await page.getByRole('button', { name: /Verificar/i }).click();
  await page.waitForURL((url) => !/\/(login|otp)/.test(url.pathname), { timeout: 30_000 });
}

test.describe('admin branding → portal propagation roundtrip', () => {
  test.setTimeout(240_000);

  test.afterEach(async ({ browser }) => {
    // Cleanup: revertir el primaryHex sin importar si el test pasó.
    // Idempotente — usamos un browser nuevo para no compartir cookies.
    try {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await loginAdmin(page);
      await setBrandingPrimary(page, ORIGINAL_PRIMARY);
      await ctx.close();
    } catch (err) {
      // Cleanup best-effort — no fallar el suite por el revert.
      // eslint-disable-next-line no-console
      console.warn('[admin-branding-roundtrip] cleanup primaryHex revert falló:', err);
    }
  });

  test.skip(
    'admin cambia primaryHex → asegurado ve el color nuevo en --tenant-primary',
    async ({ browser, request }) => {
      // blocked-by: MT-1 + MT-2 + MT-3 entrega iter 1.
      // Step 1: admin context.
      const adminCtx = await browser.newContext();
      const adminPage = await adminCtx.newPage();
      await loginAdmin(adminPage);
      await setBrandingPrimary(adminPage, NEW_PRIMARY);

      // Step 2: portal context (otra ventana — distinto cookie jar).
      const portalCtx = await browser.newContext();
      const portalPage = await portalCtx.newPage();
      await loginInsuredOtp(portalPage, request);

      // Espera SWR/render del Provider — TenantBrandingProvider escribe la
      // CSS var `--tenant-primary` al recibir 200 de /v1/tenants/me/branding.
      await expect
        .poll(
          async () =>
            portalPage.evaluate(() =>
              getComputedStyle(document.documentElement)
                .getPropertyValue('--tenant-primary')
                .trim()
                .toLowerCase(),
            ),
          { timeout: 15_000, intervals: [500, 1_000, 2_000] },
        )
        .toBe(NEW_PRIMARY.toLowerCase());

      await adminCtx.close();
      await portalCtx.close();
    },
  );
});
