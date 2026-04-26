import { EmailTemplateResolver } from '../../../../src/modules/email/email-template-resolver';

describe('EmailTemplateResolver', () => {
  it('default → certificate-issued', () => {
    const r = new EmailTemplateResolver();
    expect(r.resolveTemplateName({})).toBe('certificate-issued');
    expect(r.resolveTemplateName({ brand: null })).toBe('certificate-issued');
  });

  it('ignora emailTemplate desconocido y cae a default', () => {
    const r = new EmailTemplateResolver();
    expect(r.resolveTemplateName({ brand: { emailTemplate: 'phishing' } })).toBe('certificate-issued');
  });

  it('compila html y txt para certificate-issued', async () => {
    const r = new EmailTemplateResolver();
    const pair = await r.load('certificate-issued');
    expect(pair.name).toBe('certificate-issued');
    const html = pair.html({
      insured: { fullName: 'Juan' },
      package: { name: 'Plan' },
      validTo: '2026-12-31',
      downloadUrl: 'https://s3/foo',
      tenant: { name: 'MAC', logo: '', supportEmail: 'help@mac.com' },
    });
    expect(html).toContain('Juan');
    expect(html).toContain('Plan');
    expect(html).toContain('https://s3/foo');
    expect(html).toContain('help@mac.com');

    const txt = pair.text({
      insured: { fullName: 'Juana' },
      package: { name: 'Plus' },
      validTo: '2026-12',
      downloadUrl: 'https://s3/bar',
      tenant: { name: 'X', supportEmail: '' },
    });
    expect(txt).toContain('Juana');
    expect(txt).toContain('Plus');
    expect(txt).toContain('https://s3/bar');
  });

  it('cache LRU: misma instancia compilada en hits', async () => {
    const r = new EmailTemplateResolver();
    const a = await r.load('certificate-issued');
    const b = await r.load('certificate-issued');
    expect(a).toBe(b);
  });
});
