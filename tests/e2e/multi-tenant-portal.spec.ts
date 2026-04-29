import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Sprint 5 — MT-4 — E2E cross-tenant + cross-leak (portal asegurado).
 *
 * Cubre los 3 flows críticos de la story Multi-tenant gestionable:
 *   1. Login insured A1 → portal renderiza branding tenant A
 *      (displayName, primaryHex en CSS var `--tenant-primary`).
 *   2. Logout y login con insured B1 → branding cambia sin reload manual
 *      (TenantContext purga al logout, re-bootstrap en mount).
 *   3. Cross-leak (defensa en profundidad): con cookie/sesión de A1, intentar
 *      leer `GET /api/proxy/v1/insureds/{insuredB.id}` debe devolver **404**
 *      (anti-enumeration). Decisión Sprint 5 / CC-10 iter 2: se MANTIENE 404
 *      sobre 403 para no leakear existencia del UUID. Ver
 *      `insureds.controller.ts` (`@Get(':id/360')` doc-block) y
 *      `insureds.service.ts:431` (`NotFoundException` cuando RLS niega).
 *
 * **Pre-requisitos** (MT-1 + cognito-bootstrap multi-tenant):
 *   - Stack docker-compose up (postgres + cognito-local + LocalStack + mailpit).
 *   - `pnpm prisma:seed:multi-tenant` corrido (provee tenants `mac` +
 *     `demo-insurer`, insureds `HEGM860519MJCRRN08` + `LOPA900215HDFRRR07`).
 *   - cognito-local-bootstrap registró el insured de demo-insurer en el pool
 *     (script extension pendiente — ver feed MT-4 iter 1, blocker).
 *   - API + portal corriendo (:3000, :3002).
 *
 * **Estado iter 1** — los 3 tests están `it.skip` con motivo
 * `blocked-by: MT-1 endpoint /v1/tenants/me/branding + bootstrap multi-tenant`.
 * Iter 2 quita el skip cuando MT-1 entregue.
 *
 * **Contratos consumidos** (DISPATCH_PLAN §"Contratos a publicar"):
 *   - `GET /v1/tenants/me/branding` → `{ tenantId, displayName, tagline,
 *     logoUrl, primaryHex, accentHex, bgImageUrl, lastUpdatedAt }`
 *   - CSS var en `<html>`: `--tenant-primary: <primaryHex>` (set por
 *     TenantBrandingProvider de MT-3 al recibir branding).
 */

const PORTAL_URL = process.env['PORTAL_BASE_URL'] ?? 'http://localhost:3002';
const API_URL = process.env['API_BASE_URL'] ?? 'http://localhost:3000';

interface InsuredFixture {
  curp: string;
  email: string;
  expectedTenantSlug: string;
  expectedDisplayName: string;
  expectedPrimaryHex: string;
  expectedTagline: string;
}

const INSURED_A: InsuredFixture = {
  curp: 'HEGM860519MJCRRN08',
  email: 'insured.demo@mac.local',
  expectedTenantSlug: 'mac',
  expectedDisplayName: 'Hospitales MAC',
  expectedPrimaryHex: '#16a34a',
  expectedTagline: 'Tu salud, nuestra prioridad',
};

const INSURED_B: InsuredFixture = {
  curp: 'LOPA900215HDFRRR07',
  email: 'insured.demo@demo-insurer.local',
  expectedTenantSlug: 'demo-insurer',
  expectedDisplayName: 'Demo Insurer',
  expectedPrimaryHex: '#dc2626',
  expectedTagline: 'Cobertura confiable',
};

/**
 * Login OTP helper — extrae código de Mailpit y completa el flujo.
 * Reutilizado de `portal-otp.spec.ts` (helper local hasta que se promueva a
 * `tests/e2e/helpers/`).
 */
async function loginInsuredViaOtp(page: Page, request: APIRequestContext, insured: InsuredFixture): Promise<void> {
  await page.goto('/login', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.getByLabel(/CURP/i).fill(insured.curp);
  await page.getByRole('button', { name: /Enviar c[oó]digo/i }).click();
  await expect(page).toHaveURL(/\/otp/, { timeout: 15_000 });

  const code = await pollMailpitForOtp(request, insured.email, /\b(\d{6})\b/, 30_000);
  await page.getByLabel(/C[oó]digo de 6 d[ií]gitos/i).fill(code);
  await page.getByRole('button', { name: /Verificar/i }).click();
  await page.waitForURL((url) => !/\/(login|otp)/.test(url.pathname), { timeout: 30_000 });
}

async function pollMailpitForOtp(
  request: APIRequestContext,
  recipient: string,
  pattern: RegExp,
  timeoutMs: number,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request.get('http://localhost:8025/api/v1/messages?query=' + encodeURIComponent(`to:${recipient}`));
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
  throw new Error(`OTP code for ${recipient} not received in Mailpit within ${timeoutMs}ms`);
}

async function readCssVar(page: Page, varName: string): Promise<string> {
  return page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    varName,
  );
}

test.describe('multi-tenant portal — cross-tenant rendering', () => {
  test.setTimeout(180_000);

  test.skip(
    'insured A1 (Hospitales MAC) ve branding tenant A en /dashboard',
    async ({ page, request }) => {
      // blocked-by: MT-1 endpoint /v1/tenants/me/branding + bootstrap multi-tenant.
      await loginInsuredViaOtp(page, request, INSURED_A);

      // Assertion 1: displayName visible en header.
      await expect(page.getByText(INSURED_A.expectedDisplayName)).toBeVisible({
        timeout: 15_000,
      });

      // Assertion 2: tagline visible (header o footer del portal).
      await expect(page.getByText(INSURED_A.expectedTagline)).toBeVisible();

      // Assertion 3: CSS var --tenant-primary == #16a34a.
      const primary = await readCssVar(page, '--tenant-primary');
      expect(primary.toLowerCase()).toBe(INSURED_A.expectedPrimaryHex.toLowerCase());

      // Assertion 4: el header NO muestra el displayName del tenant B.
      await expect(page.getByText(INSURED_B.expectedDisplayName)).toHaveCount(0);

      // Assertion 5: GET /api/proxy/v1/tenants/me/branding devuelve tenantId
      // del tenant A (sanity del JWT).
      const brandingResp = await page.request.get('/api/proxy/v1/tenants/me/branding');
      expect(brandingResp.status()).toBe(200);
      const branding = (await brandingResp.json()) as { displayName: string; primaryHex: string };
      expect(branding.displayName).toBe(INSURED_A.expectedDisplayName);
      expect(branding.primaryHex.toLowerCase()).toBe(INSURED_A.expectedPrimaryHex.toLowerCase());
    },
  );

  test.skip(
    'insured A1 → /coverages renderiza solo coberturas del tenant A',
    async ({ page, request }) => {
      // blocked-by: MT-1 endpoint + bootstrap multi-tenant.
      await loginInsuredViaOtp(page, request, INSURED_A);

      await page.goto('/coverages');
      await expect(page.getByText(/Consultas m[eé]dicas/i)).toBeVisible();

      // Sanity: el JSON del backend trae tenantId del tenant A — el JWT del
      // insured filtra el listado server-side (RLS + WHERE tenant_id).
      const coveragesResp = await page.request.get('/api/proxy/v1/insureds/me/coverages');
      expect(coveragesResp.status()).toBe(200);
      const coverages = (await coveragesResp.json()) as Array<{ tenantId: string }>;
      expect(coverages.length).toBeGreaterThan(0);
      const tenantIds = new Set(coverages.map((c) => c.tenantId));
      expect(tenantIds.size).toBe(1); // Sin filtraciones cross-tenant.
    },
  );

  test.skip(
    'logout + login B1 → branding muta sin reload (TenantContext purgado)',
    async ({ page, request, context }) => {
      // blocked-by: MT-3 logout purga TenantBrandingProvider state.
      await loginInsuredViaOtp(page, request, INSURED_A);
      const primaryA = await readCssVar(page, '--tenant-primary');
      expect(primaryA.toLowerCase()).toBe(INSURED_A.expectedPrimaryHex.toLowerCase());

      // Logout via menú de usuario.
      await page.getByRole('button', { name: /(perfil|men[uú])/i }).click();
      await page.getByRole('menuitem', { name: /Cerrar sesi[oó]n/i }).click();
      await page.waitForURL('**/login', { timeout: 15_000 });

      // Cookie debe estar limpia (TenantContext purgado por el logout).
      const cookies = await context.cookies();
      const sessionCookie = cookies.find((c) => /session|access|id/i.test(c.name));
      expect(sessionCookie).toBeUndefined();

      // Login con insured B (tenant demo-insurer).
      await loginInsuredViaOtp(page, request, INSURED_B);
      await expect(page.getByText(INSURED_B.expectedDisplayName)).toBeVisible({ timeout: 15_000 });

      const primaryB = await readCssVar(page, '--tenant-primary');
      expect(primaryB.toLowerCase()).toBe(INSURED_B.expectedPrimaryHex.toLowerCase());
      expect(primaryB.toLowerCase()).not.toBe(INSURED_A.expectedPrimaryHex.toLowerCase());

      // El displayName del tenant A NO debe sobrevivir el switch.
      await expect(page.getByText(INSURED_A.expectedDisplayName)).toHaveCount(0);
    },
  );

  test.skip(
    'cross-leak: A1 NO puede leer insured de B vía /api/proxy (404 anti-enumeration)',
    async ({ page, request }) => {
      // blocked-by: MT-1 endpoint /v1/insureds/:id RLS check.
      // Pre: insured B1 id se obtiene via API admin (out-of-band).
      const adminToken = process.env['ADMIN_TEST_TOKEN'];
      test.skip(!adminToken, 'ADMIN_TEST_TOKEN env var ausente — set in CI');

      const insuredsB = await request.get(`${API_URL}/v1/insureds?tenant=demo-insurer`, {
        headers: { Authorization: `Bearer ${adminToken!}` },
      });
      expect(insuredsB.status()).toBe(200);
      const list = (await insuredsB.json()) as { items: Array<{ id: string; curp: string }> };
      const insuredB = list.items.find((i) => i.curp === INSURED_B.curp);
      if (!insuredB) throw new Error('Insured B no encontrado en seed multi-tenant');

      // Login como A1.
      await loginInsuredViaOtp(page, request, INSURED_A);

      // Intento de leak — debe ser 404 (anti-enumeration).
      // Sprint 5 / CC-10 iter 2: re-evaluado. 403 filtraría existencia del
      // UUID; 404 mantiene la indistinguibilidad "no existe / no autorizado"
      // que ya implementa `insureds.service.ts:findOne` (NotFoundException
      // cuando RLS niega). Ver doc-block de `find360` en el controller.
      const leakResp = await page.request.get(`/api/proxy/v1/insureds/${insuredB.id}`);
      expect(leakResp.status()).toBe(404);

      // Defensa secundaria: aunque el frontend tuviera bug, el body NO
      // debe contener PII de B.
      const text = await leakResp.text();
      expect(text).not.toContain(INSURED_B.curp);
      expect(text).not.toContain('Andrés López');
    },
  );
});
