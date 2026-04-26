import { buildVerificationQr } from '../../../../src/modules/certificates/qr-generator';

describe('qr-generator', () => {
  it('genera data URL PNG válido y payload con URL pública', async () => {
    const out = await buildVerificationQr({ baseUrl: 'http://localhost:3000', hash: 'a'.repeat(64) });
    expect(out.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(out.payload).toBe(`http://localhost:3000/v1/certificates/verify/${'a'.repeat(64)}`);
  });

  it('normaliza trailing slash en baseUrl', async () => {
    const out = await buildVerificationQr({ baseUrl: 'http://localhost:3000/', hash: 'b'.repeat(64) });
    expect(out.payload).toBe(`http://localhost:3000/v1/certificates/verify/${'b'.repeat(64)}`);
  });

  it('soporta baseUrl con múltiples slashes', async () => {
    const out = await buildVerificationQr({ baseUrl: 'http://api.example.com///', hash: 'c'.repeat(8) });
    expect(out.payload).toBe(`http://api.example.com/v1/certificates/verify/${'c'.repeat(8)}`);
  });

  it('lanza si hash es vacío', async () => {
    await expect(buildVerificationQr({ baseUrl: 'http://x', hash: '' })).rejects.toThrow(/hash/);
  });
});
