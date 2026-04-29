/**
 * Sprint 5 — MT-1 unit tests del `BrandingService`.
 *
 * Cobertura iter 1 (≥10 cases, target ≥80% statements):
 *  - get: shape canónica con fallbacks ("SegurAsist", hex defaults, null logoUrl).
 *  - get: tenant inexistente → NotFoundException.
 *  - get: tenant soft-deleted → NotFoundException.
 *  - cache: 2da llamada NO toca BD dentro de TTL.
 *  - cache: 3ra llamada tras `purgeCache` SÍ toca BD.
 *  - update: persiste fields + bump branding_updated_at + invalida cache.
 *  - update: tagline string vacío se persiste como null.
 *  - update: tenant inexistente → NotFoundException.
 *  - uploadLogo: delega al UploadService + persiste URL + invalida cache + bump ts.
 *  - clearLogo: persiste null + bump branding_updated_at.
 *  - hex regex: sólo `#RRGGBB` aceptado por el Zod schema.
 *  - file-magic: PNG/SVG/WebP detectados; EXE/PDF rechazados (vía detectFileType).
 *
 * Mocks: PrismaBypassRlsService.client.tenant + BrandingUploadService.
 */
import { NotFoundException } from '@nestjs/common';
import type { PrismaBypassRlsService } from '../../../../src/common/prisma/prisma-bypass-rls.service';
import { BrandingUploadService } from '../../../../src/modules/admin/tenants/branding-upload.service';
import { BrandingService } from '../../../../src/modules/tenants/branding/branding.service';
import {
  HexColorSchema,
  UpdateBrandingSchema,
} from '../../../../src/modules/tenants/branding/dto/branding.dto';
import { detectFileType } from '../../../../src/common/utils/file-magic-bytes';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

interface Harness {
  svc: BrandingService;
  findUnique: jest.Mock;
  findFirst: jest.Mock;
  update: jest.Mock;
  uploadLogo: jest.Mock;
}

function makeHarness(): Harness {
  const findUnique = jest.fn();
  const findFirst = jest.fn();
  const update = jest.fn();

  const prisma = {
    client: {
      tenant: { findUnique, findFirst, update },
    },
  } as unknown as PrismaBypassRlsService;

  const uploadLogo = jest.fn().mockResolvedValue('https://cdn.segurasist.app/T/logo-1.png');
  const upload = { uploadLogo } as unknown as BrandingUploadService;

  return {
    svc: new BrandingService(prisma, upload),
    findUnique,
    findFirst,
    update,
    uploadLogo,
  };
}

function makeTenantRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: TENANT_ID,
    name: 'Hospitales MAC',
    displayName: null,
    tagline: null,
    brandingLogoUrl: null,
    brandingPrimaryHex: null,
    brandingAccentHex: null,
    brandingBgImageUrl: null,
    brandingUpdatedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

describe('BrandingService.getBrandingForTenant', () => {
  it('aplica fallbacks: displayName=tenant.name, hex defaults, logo/bg null', async () => {
    const h = makeHarness();
    h.findUnique.mockResolvedValueOnce(makeTenantRow());

    const dto = await h.svc.getBrandingForTenant(TENANT_ID);

    expect(dto).toEqual({
      tenantId: TENANT_ID,
      displayName: 'Hospitales MAC',
      tagline: null,
      logoUrl: null,
      primaryHex: '#16a34a',
      accentHex: '#7c3aed',
      bgImageUrl: null,
      lastUpdatedAt: null,
    });
  });

  it('devuelve los valores custom cuando el tenant tiene branding', async () => {
    const h = makeHarness();
    const updatedAt = new Date('2026-04-28T10:00:00Z');
    h.findUnique.mockResolvedValueOnce(
      makeTenantRow({
        displayName: 'Hospitales MAC Premium',
        tagline: 'Tu salud, nuestra prioridad',
        brandingLogoUrl: 'https://cdn.segurasist.app/T/logo-99.png',
        brandingPrimaryHex: '#ff0000',
        brandingAccentHex: '#00ff00',
        brandingBgImageUrl: 'https://cdn.segurasist.app/T/bg-7.webp',
        brandingUpdatedAt: updatedAt,
      }),
    );

    const dto = await h.svc.getBrandingForTenant(TENANT_ID);

    expect(dto.displayName).toBe('Hospitales MAC Premium');
    expect(dto.tagline).toBe('Tu salud, nuestra prioridad');
    expect(dto.logoUrl).toBe('https://cdn.segurasist.app/T/logo-99.png');
    expect(dto.primaryHex).toBe('#ff0000');
    expect(dto.accentHex).toBe('#00ff00');
    expect(dto.bgImageUrl).toBe('https://cdn.segurasist.app/T/bg-7.webp');
    expect(dto.lastUpdatedAt).toBe('2026-04-28T10:00:00.000Z');
  });

  it('lanza NotFoundException si el tenant no existe', async () => {
    const h = makeHarness();
    h.findUnique.mockResolvedValueOnce(null);

    await expect(h.svc.getBrandingForTenant(TENANT_ID)).rejects.toThrow(NotFoundException);
  });

  it('lanza NotFoundException si el tenant está soft-deleted', async () => {
    const h = makeHarness();
    h.findUnique.mockResolvedValueOnce(makeTenantRow({ deletedAt: new Date() }));

    await expect(h.svc.getBrandingForTenant(TENANT_ID)).rejects.toThrow(NotFoundException);
  });

  it('cache hit: la 2da llamada dentro del TTL NO toca la BD', async () => {
    const h = makeHarness();
    h.findUnique.mockResolvedValueOnce(makeTenantRow());

    await h.svc.getBrandingForTenant(TENANT_ID);
    await h.svc.getBrandingForTenant(TENANT_ID);

    expect(h.findUnique).toHaveBeenCalledTimes(1);
  });

  it('cache miss tras purgeCache(): la próxima llamada SÍ toca BD', async () => {
    const h = makeHarness();
    h.findUnique.mockResolvedValue(makeTenantRow());

    await h.svc.getBrandingForTenant(TENANT_ID);
    h.svc.purgeCache(TENANT_ID);
    await h.svc.getBrandingForTenant(TENANT_ID);

    expect(h.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('BrandingService.updateBranding', () => {
  it('persiste fields + bumpea branding_updated_at + invalida cache', async () => {
    const h = makeHarness();
    h.findFirst.mockResolvedValueOnce({ id: TENANT_ID });
    h.update.mockResolvedValueOnce({});
    // post-update getBrandingForTenant lee de BD nuevamente:
    h.findUnique.mockResolvedValueOnce(
      makeTenantRow({
        displayName: 'GNP Asistencia',
        brandingPrimaryHex: '#abcdef',
        brandingAccentHex: '#123456',
        brandingUpdatedAt: new Date('2026-04-28T11:00:00Z'),
      }),
    );

    const dto = await h.svc.updateBranding(TENANT_ID, {
      displayName: 'GNP Asistencia',
      tagline: undefined,
      primaryHex: '#abcdef',
      accentHex: '#123456',
      bgImageUrl: undefined,
    });

    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TENANT_ID },
        data: expect.objectContaining({
          displayName: 'GNP Asistencia',
          tagline: null,
          brandingPrimaryHex: '#abcdef',
          brandingAccentHex: '#123456',
          brandingUpdatedAt: expect.any(Date),
        }),
      }),
    );
    // bgImageUrl undefined ⇒ NO debe aparecer en data (preserva valor previo)
    const dataArg = h.update.mock.calls[0][0].data as Record<string, unknown>;
    expect('brandingBgImageUrl' in dataArg).toBe(false);
    expect(dto.displayName).toBe('GNP Asistencia');
  });

  it('si bgImageUrl viene en el DTO, lo persiste', async () => {
    const h = makeHarness();
    h.findFirst.mockResolvedValueOnce({ id: TENANT_ID });
    h.update.mockResolvedValueOnce({});
    h.findUnique.mockResolvedValueOnce(makeTenantRow());

    await h.svc.updateBranding(TENANT_ID, {
      displayName: 'X',
      primaryHex: '#000000',
      accentHex: '#ffffff',
      bgImageUrl: 'https://cdn.example.com/bg.webp',
    });

    const dataArg = h.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(dataArg.brandingBgImageUrl).toBe('https://cdn.example.com/bg.webp');
  });

  it('lanza NotFoundException si el tenant no existe', async () => {
    const h = makeHarness();
    h.findFirst.mockResolvedValueOnce(null);

    await expect(
      h.svc.updateBranding(TENANT_ID, {
        displayName: 'X',
        primaryHex: '#000000',
        accentHex: '#ffffff',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(h.update).not.toHaveBeenCalled();
  });
});

describe('BrandingService.uploadLogo', () => {
  it('delega al UploadService + persiste URL devuelta + invalida cache', async () => {
    const h = makeHarness();
    h.findFirst.mockResolvedValueOnce({ id: TENANT_ID });
    h.update.mockResolvedValueOnce({});
    h.findUnique.mockResolvedValueOnce(
      makeTenantRow({ brandingLogoUrl: 'https://cdn.segurasist.app/T/logo-1.png' }),
    );

    const dto = await h.svc.uploadLogo({
      tenantId: TENANT_ID,
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      mime: 'image/png',
    });

    expect(h.uploadLogo).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      buffer: expect.any(Buffer),
      mime: 'image/png',
    });
    expect(h.update).toHaveBeenCalledWith({
      where: { id: TENANT_ID },
      data: {
        brandingLogoUrl: 'https://cdn.segurasist.app/T/logo-1.png',
        brandingUpdatedAt: expect.any(Date),
      },
    });
    expect(dto.logoUrl).toBe('https://cdn.segurasist.app/T/logo-1.png');
  });

  it('NotFoundException si el tenant no existe (no llama al uploader)', async () => {
    const h = makeHarness();
    h.findFirst.mockResolvedValueOnce(null);

    await expect(
      h.svc.uploadLogo({
        tenantId: TENANT_ID,
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        mime: 'image/png',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(h.uploadLogo).not.toHaveBeenCalled();
  });
});

describe('BrandingService.clearLogo', () => {
  it('setea logo a null + bumpea branding_updated_at + invalida cache', async () => {
    const h = makeHarness();
    h.findFirst.mockResolvedValueOnce({ id: TENANT_ID });
    h.update.mockResolvedValueOnce({});
    h.findUnique.mockResolvedValueOnce(makeTenantRow({ brandingLogoUrl: null }));

    const dto = await h.svc.clearLogo(TENANT_ID);

    expect(h.update).toHaveBeenCalledWith({
      where: { id: TENANT_ID },
      data: { brandingLogoUrl: null, brandingUpdatedAt: expect.any(Date) },
    });
    expect(dto.logoUrl).toBeNull();
  });
});

describe('Hex / DTO validation (regex ^#[0-9a-fA-F]{6}$)', () => {
  it('acepta hex válido `#RRGGBB`', () => {
    expect(HexColorSchema.parse('#16a34a')).toBe('#16a34a');
    expect(HexColorSchema.parse('#FFFFFF')).toBe('#FFFFFF');
  });

  it('rechaza hex con 3 chars (`#fff`), sin `#`, con espacio o con char inválido', () => {
    expect(() => HexColorSchema.parse('#fff')).toThrow();
    expect(() => HexColorSchema.parse('16a34a')).toThrow();
    expect(() => HexColorSchema.parse('#zzzzzz')).toThrow();
    expect(() => HexColorSchema.parse('#16a34a ')).toThrow();
  });

  it('UpdateBrandingSchema rechaza body con hex inválido o displayName vacío', () => {
    expect(() =>
      UpdateBrandingSchema.parse({ displayName: '', primaryHex: '#000000', accentHex: '#ffffff' }),
    ).toThrow();
    expect(() =>
      UpdateBrandingSchema.parse({ displayName: 'X', primaryHex: 'red', accentHex: '#ffffff' }),
    ).toThrow();
  });

  it('UpdateBrandingSchema acepta tagline opcional y bgImageUrl opcional', () => {
    const parsed = UpdateBrandingSchema.parse({
      displayName: 'GNP',
      tagline: 'Cuidando lo que más importa',
      primaryHex: '#0a0b0c',
      accentHex: '#aabbcc',
      bgImageUrl: 'https://cdn.example.com/bg.webp',
    });
    expect(parsed.tagline).toBe('Cuidando lo que más importa');
    expect(parsed.bgImageUrl).toBe('https://cdn.example.com/bg.webp');
  });

  it('UpdateBrandingSchema rechaza bgImageUrl que no sea URL absoluta', () => {
    expect(() =>
      UpdateBrandingSchema.parse({
        displayName: 'X',
        primaryHex: '#000000',
        accentHex: '#ffffff',
        bgImageUrl: '/relative/path.png',
      }),
    ).toThrow();
  });
});

describe('file-magic-bytes detection (PNG/SVG/WebP) — usado por el admin controller', () => {
  it('detecta PNG por su firma 89 50 4E 47 0D 0A 1A 0A', () => {
    const buf = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(20, 0xab),
    ]);
    expect(detectFileType(buf)).toBe('png');
  });

  it('detecta WebP por RIFF .... WEBP', () => {
    const buf = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x10, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP', 'ascii'),
      Buffer.alloc(20, 0xcd),
    ]);
    expect(detectFileType(buf)).toBe('webp');
  });

  it('detecta SVG por marcador `<svg`', () => {
    const buf = Buffer.from(
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
      'utf8',
    );
    expect(detectFileType(buf)).toBe('svg');
  });

  it('rechaza un EXE (firma MZ) — devuelve unknown', () => {
    const buf = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(50, 0xff)]);
    expect(detectFileType(buf)).toBe('unknown');
  });

  it('rechaza un GIF (firma GIF89a) — devuelve unknown (no es PNG/SVG/WebP)', () => {
    const buf = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(20, 0x00)]);
    expect(detectFileType(buf)).toBe('unknown');
  });

  it('un texto que NO es SVG (sin <svg>) NO se detecta como SVG', () => {
    const buf = Buffer.from('Hola, esto es un mensaje normal', 'utf8');
    // Caería en csv (texto ASCII), NO svg.
    expect(detectFileType(buf)).not.toBe('svg');
  });
});
