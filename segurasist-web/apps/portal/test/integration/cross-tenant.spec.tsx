/**
 * Sprint 5 — MT-4 — Cross-tenant unit/integration sanity check.
 *
 * No es un E2E: testea que los componentes del portal que consumen
 * `useTenantBranding()` rinden de forma diferente cuando el Provider expone
 * branding del tenant A vs tenant B.
 *
 * El hook `useTenantBranding` lo entrega MT-3
 * (`apps/portal/lib/hooks/use-tenant-branding.ts`). Mientras MT-3 no lo
 * publique en iter 1, este spec mockea el módulo completo y verifica el
 * contrato sobre `TenantBrandingContext` (que ya existe — Sprint 4 lo
 * dejó shadowed en `components/tenant/tenant-context.tsx`).
 *
 * Asserts:
 *   - Render con tenant A → `displayName="Hospitales MAC"` aparece en DOM.
 *   - Render con tenant B → `displayName="Demo Insurer"` aparece, MAC NO.
 *   - CSS var `--tenant-primary` aplicada via `<style>` inline difiere
 *     entre A y B (mock simplificado — el wiring real lo hace MT-3).
 *
 * Si MT-3 no entrega `useTenantBranding` en iter 1, la función mock vive
 * acá hasta iter 2.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import {
  TenantBrandingContext,
  type TenantBranding,
  DEFAULT_TENANT_BRANDING,
} from '../../components/tenant/tenant-context';

const TENANT_A: TenantBranding = {
  ...DEFAULT_TENANT_BRANDING,
  tenantId: '00000000-0000-0000-0000-00000000000A',
  displayName: 'Hospitales MAC',
  tagline: 'Tu salud, nuestra prioridad',
  primaryHex: '#16a34a',
  accentHex: '#7c3aed',
  isLoading: false,
};

const TENANT_B: TenantBranding = {
  ...DEFAULT_TENANT_BRANDING,
  tenantId: '00000000-0000-0000-0000-00000000000B',
  displayName: 'Demo Insurer',
  tagline: 'Cobertura confiable',
  primaryHex: '#dc2626',
  accentHex: '#0891b2',
  isLoading: false,
};

/**
 * Stand-in para el header brandeado (MT-3 lo entregará en
 * `components/layout/branded-header.tsx`). Aquí lo definimos inline para
 * aislar el test del work-in-progress de MT-3.
 */
function BrandedHeaderStub(): React.ReactElement {
  const branding = React.useContext(TenantBrandingContext);
  return (
    <header data-testid="branded-header">
      <span data-testid="display-name">{branding.displayName}</span>
      {branding.tagline ? (
        <span data-testid="tagline">{branding.tagline}</span>
      ) : null}
      <style>{`:root { --tenant-primary: ${branding.primaryHex}; --tenant-accent: ${branding.accentHex}; }`}</style>
    </header>
  );
}

describe('cross-tenant portal sanity (Vitest unit-level)', () => {
  it('renderiza displayName de tenant A cuando el Provider emite branding A', () => {
    render(
      <TenantBrandingContext.Provider value={TENANT_A}>
        <BrandedHeaderStub />
      </TenantBrandingContext.Provider>,
    );

    expect(screen.getByTestId('display-name').textContent).toBe('Hospitales MAC');
    expect(screen.getByTestId('tagline').textContent).toBe('Tu salud, nuestra prioridad');
    expect(screen.queryByText('Demo Insurer')).toBeNull();
  });

  it('renderiza displayName de tenant B cuando el Provider emite branding B', () => {
    render(
      <TenantBrandingContext.Provider value={TENANT_B}>
        <BrandedHeaderStub />
      </TenantBrandingContext.Provider>,
    );

    expect(screen.getByTestId('display-name').textContent).toBe('Demo Insurer');
    expect(screen.getByTestId('tagline').textContent).toBe('Cobertura confiable');
    expect(screen.queryByText('Hospitales MAC')).toBeNull();
  });

  it('aplica --tenant-primary diferente entre tenant A y tenant B', () => {
    const { rerender, container } = render(
      <TenantBrandingContext.Provider value={TENANT_A}>
        <BrandedHeaderStub />
      </TenantBrandingContext.Provider>,
    );

    const styleA = container.querySelector('style')?.textContent ?? '';
    expect(styleA).toContain('--tenant-primary: #16a34a');
    expect(styleA).not.toContain('#dc2626');

    rerender(
      <TenantBrandingContext.Provider value={TENANT_B}>
        <BrandedHeaderStub />
      </TenantBrandingContext.Provider>,
    );

    const styleB = container.querySelector('style')?.textContent ?? '';
    expect(styleB).toContain('--tenant-primary: #dc2626');
    expect(styleB).not.toContain('#16a34a');
  });

  it('default branding (Provider ausente) no fugea displayName de ningún tenant seedeado', () => {
    // Sanity: defaults son institucionales SegurAsist. Si por error
    // el default trae "Hospitales MAC" hard-coded, este test rompe.
    render(<BrandedHeaderStub />);
    expect(screen.getByTestId('display-name').textContent).toBe('SegurAsist');
    expect(screen.queryByText('Hospitales MAC')).toBeNull();
    expect(screen.queryByText('Demo Insurer')).toBeNull();
  });
});
