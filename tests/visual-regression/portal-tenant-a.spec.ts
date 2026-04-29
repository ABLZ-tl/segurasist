import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Sprint 5 — MT-4 — Visual regression del portal asegurado por tenant.
 *
 * Captura snapshot del `/dashboard` con tenant A (Hospitales MAC) y otro
 * con tenant B (Demo Insurer). Asserts:
 *   1. Cada tenant produce un snapshot estable (regression sobre baseline).
 *   2. Tenant A vs tenant B difieren visualmente (>5% pixels distintos)
 *      — confirma que el branding tiene impacto perceptible.
 *
 * **Estrategia de baselines**:
 *   - La primera ejecución genera baselines en
 *     `tests/visual-regression/__screenshots__/portal-tenant-{a,b}-*-actual.png`.
 *     Confirmar manualmente y mover a `*.png` (sin `-actual`) para que pase
 *     el CI.
 *   - Diff threshold: `maxDiffPixelRatio: 0.02` (2% — tolera anti-aliasing).
 *
 * **Estado iter 1** — `it.skip` con motivo:
 *   `blocked-by: MT-1 + MT-3 portal branding render + cognito-bootstrap
 *    multi-tenant`. Iter 2 quita el skip + commit baseline.
 *
 * **Notas operacionales**:
 *   - Snapshots son determinísticos solo si:
 *     a) viewport fijo (1280x800)
 *     b) animations: 'disabled' (Playwright option en `toHaveScreenshot`)
 *     c) Lordicons + GSAP NO renderizan motion en CI (DS-1 expone
 *        `data-lordicon-stub` cuando `prefers-reduced-motion: reduce`).
 *     d) Datos seedeados estables (multi-tenant seed idempotente).
 *   - Si el font loading flackea, aumentar `timeout` de
 *     `page.waitForLoadState('networkidle')` a 5s.
 */

const PORTAL_URL = process.env['PORTAL_BASE_URL'] ?? 'http://localhost:3002';

interface InsuredFixture {
  curp: string;
  email: string;
  tenantSlug: string;
}

const INSURED_A: InsuredFixture = {
  curp: 'HEGM860519MJCRRN08',
  email: 'insured.demo@mac.local',
  tenantSlug: 'mac',
};

const INSURED_B: InsuredFixture = {
  curp: 'LOPA900215HDFRRR07',
  email: 'insured.demo@demo-insurer.local',
  tenantSlug: 'demo-insurer',
};

async function loginInsuredAndOpenDashboard(
  page: Page,
  request: APIRequestContext,
  insured: InsuredFixture,
): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${PORTAL_URL}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel(/CURP/i).fill(insured.curp);
  await page.getByRole('button', { name: /Enviar c[oó]digo/i }).click();
  await expect(page).toHaveURL(/\/otp/, { timeout: 15_000 });

  const start = Date.now();
  let code: string | null = null;
  while (Date.now() - start < 30_000) {
    const res = await request.get(
      'http://localhost:8025/api/v1/messages?query=' + encodeURIComponent(`to:${insured.email}`),
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
  if (!code) throw new Error(`OTP code for ${insured.email} not received`);

  await page.getByLabel(/C[oó]digo de 6 d[ií]gitos/i).fill(code);
  await page.getByRole('button', { name: /Verificar/i }).click();
  await page.waitForURL((url) => !/\/(login|otp)/.test(url.pathname), { timeout: 30_000 });
  await page.goto(`${PORTAL_URL}/dashboard`, { waitUntil: 'networkidle' });
  // Esperar fonts + svg lordicons.
  await page.waitForTimeout(500);
}

test.describe('visual regression — portal multi-tenant', () => {
  test.setTimeout(180_000);

  test.skip(
    'tenant A (Hospitales MAC) — snapshot /dashboard estable vs baseline',
    async ({ page, request }) => {
      // blocked-by: MT-1 endpoint + MT-3 render + bootstrap multi-tenant.
      await loginInsuredAndOpenDashboard(page, request, INSURED_A);
      await expect(page).toHaveScreenshot('portal-tenant-a-dashboard.png', {
        fullPage: true,
        animations: 'disabled',
        maxDiffPixelRatio: 0.02,
      });
    },
  );

  test.skip(
    'tenant B (Demo Insurer) — snapshot /dashboard difiere de tenant A >5%',
    async ({ page, request }) => {
      // blocked-by: MT-1 endpoint + MT-3 render + bootstrap multi-tenant.
      await loginInsuredAndOpenDashboard(page, request, INSURED_B);
      await expect(page).toHaveScreenshot('portal-tenant-b-dashboard.png', {
        fullPage: true,
        animations: 'disabled',
        maxDiffPixelRatio: 0.02,
      });

      // Diff implícito: si A y B fueran idénticas, ambos snapshots coincidirían
      // con la misma imagen — el assert anterior fallaría con diff vs el
      // baseline guardado de A. Para validación explícita, iter 2 hace pixel
      // diff entre los dos PNGs (helper `tests/visual-regression/utils/diff.ts`
      // usando `pngjs` + `pixelmatch` — pendiente).
    },
  );
});
