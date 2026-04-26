import { TemplateResolver } from '../../../../src/modules/certificates/template-resolver';

describe('TemplateResolver', () => {
  let resolver: TemplateResolver;

  beforeEach(() => {
    resolver = new TemplateResolver();
  });

  describe('resolveTemplateName', () => {
    it('usa brand.template cuando es conocido (mac)', () => {
      expect(resolver.resolveTemplateName({ brand: { template: 'mac' } })).toBe('mac');
    });

    it('usa brand.template cuando es default explícito', () => {
      expect(resolver.resolveTemplateName({ brand: { template: 'default' } })).toBe('default');
    });

    it('ignora brand.template desconocido y cae a slug', () => {
      expect(resolver.resolveTemplateName({ brand: { template: 'pirata' }, tenantSlug: 'mac' })).toBe('mac');
    });

    it('usa tenant slug si matchea (mac)', () => {
      expect(resolver.resolveTemplateName({ tenantSlug: 'mac' })).toBe('mac');
    });

    it('default si nada matchea', () => {
      expect(resolver.resolveTemplateName({})).toBe('default');
      expect(resolver.resolveTemplateName({ tenantSlug: 'desconocido' })).toBe('default');
    });

    it('null brand → default', () => {
      expect(resolver.resolveTemplateName({ brand: null })).toBe('default');
    });
  });

  describe('load', () => {
    it('compila default.hbs', async () => {
      const tpl = await resolver.load('default');
      const out = tpl({
        certificateNumber: 'X',
        version: 1,
        issuedAt: '2026-04-25',
        insured: { fullName: 'Juan', curp: 'JUAN850101HMNXXX01' },
        package: { name: 'Plan A' },
        coverages: [],
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        tenant: { name: 'Tenant X', logo: '', colors: { primary: '#000', accent: '#111' }, legal: 'L' },
        qrCodeDataUrl: 'data:image/png;base64,abc',
        verificationUrl: 'http://x',
        hashShort: 'abcdef',
      });
      expect(out).toContain('Juan');
      expect(out).toContain('Plan A');
      expect(out).toContain('Tenant X');
    });

    it('compila mac.hbs y muestra colores fijos MAC', async () => {
      const tpl = await resolver.load('mac');
      const out = tpl({
        certificateNumber: 'Y',
        version: 1,
        issuedAt: 'now',
        insured: { fullName: 'Juana', curp: 'JUAN' },
        package: { name: 'Plan B' },
        coverages: [
          { name: 'Consulta', type: 'consultation', limitFormatted: '$100', copaymentFormatted: '-' },
        ],
        validFrom: '01',
        validTo: '02',
        tenant: { name: 'MAC', logo: 'http://logo', colors: {}, legal: 'Legal MAC' },
        qrCodeDataUrl: 'data:image/png;base64,abc',
        verificationUrl: 'http://x',
        hashShort: 'aabb',
      });
      expect(out).toContain('--primary: #0B5394');
      expect(out).toContain('Legal MAC');
      expect(out).toContain('Consulta');
    });

    it('rechaza plantilla desconocida', async () => {
      await expect(resolver.load('phishing')).rejects.toThrow(/desconocida/);
    });
  });

  describe('cache', () => {
    it('reutiliza la plantilla compilada (mismo objeto)', async () => {
      const a = await resolver.load('default');
      const b = await resolver.load('default');
      expect(a).toBe(b);
    });

    it('clearCache fuerza re-compilación', async () => {
      const a = await resolver.load('default');
      resolver.clearCache();
      const b = await resolver.load('default');
      expect(a).not.toBe(b);
    });
  });
});
