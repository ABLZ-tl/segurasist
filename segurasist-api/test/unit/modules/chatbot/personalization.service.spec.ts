/**
 * Unit tests S4-07 PersonalizationService.
 *
 * Estrategia:
 *   - `applyTemplate` testea la lógica del template engine PURO sin Prisma —
 *     un `InsuredContext` armado a mano cubre placeholders y edge cases.
 *   - `fillPlaceholders` valida la integración Prisma (mock deep) → context.
 *
 * Cubrimos:
 *   - Sustitución de TODOS los placeholders.
 *   - Fallback "—" cuando packageName / coverages están vacíos.
 *   - Formato es-MX de fechas ("15 de enero de 2027").
 *   - NotFound propaga si insured no existe.
 *   - Determinismo (idempotencia del replace).
 */
import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../../src/common/prisma/prisma.service';
import {
  type InsuredContext,
  PersonalizationService,
} from '../../../../src/modules/chatbot/personalization.service';

function makeService(): { svc: PersonalizationService; insuredFindUnique: jest.Mock } {
  const insuredFindUnique = jest.fn();
  const prisma = {
    client: {
      insured: { findUnique: insuredFindUnique },
    },
  } as unknown as PrismaService;
  const svc = new PersonalizationService(prisma);
  return { svc, insuredFindUnique };
}

function makeCtx(overrides: Partial<InsuredContext> = {}): InsuredContext {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    fullName: 'Juan Pérez García',
    firstName: 'Juan',
    validFrom: new Date('2026-01-15T12:00:00Z'),
    validTo: new Date('2027-01-15T12:00:00Z'),
    packageName: 'Plan Plata',
    coverages: [{ name: 'Hospitalización' }, { name: 'Cirugía' }],
    claimsCount: 2,
    ...overrides,
  };
}

describe('PersonalizationService.applyTemplate', () => {
  let svc: PersonalizationService;

  beforeEach(() => {
    svc = makeService().svc;
  });

  it('reemplaza {{validTo}} con fecha es-MX', () => {
    const out = svc.applyTemplate('Tu póliza vence el {{validTo}}.', makeCtx());
    expect(out).toContain('15 de enero de 2027');
    expect(out).not.toContain('{{validTo}}');
  });

  it('reemplaza {{validFrom}} con fecha es-MX', () => {
    const out = svc.applyTemplate('Vigencia desde {{validFrom}}.', makeCtx());
    expect(out).toContain('15 de enero de 2026');
  });

  it('reemplaza {{fullName}} y {{firstName}}', () => {
    const out = svc.applyTemplate('Hola {{firstName}}, {{fullName}}', makeCtx());
    expect(out).toBe('Hola Juan, Juan Pérez García');
  });

  it('{{packageName}} y {{packageType}} usan packageName', () => {
    const out = svc.applyTemplate('{{packageName}} / {{packageType}}', makeCtx());
    expect(out).toBe('Plan Plata / Plan Plata');
  });

  it('packageName null → "—"', () => {
    const out = svc.applyTemplate('{{packageName}}', makeCtx({ packageName: null }));
    expect(out).toBe('—');
  });

  it('coverages vacías → {{coveragesList}} = "—" y {{coveragesCount}} = "0"', () => {
    const out = svc.applyTemplate(
      'count={{coveragesCount}} list={{coveragesList}}',
      makeCtx({ coverages: [] }),
    );
    expect(out).toBe('count=0 list=—');
  });

  it('coveragesList comma-separated', () => {
    const out = svc.applyTemplate('{{coveragesList}}', makeCtx());
    expect(out).toBe('Hospitalización, Cirugía');
  });

  it('{{claimsCount}} stringifica número', () => {
    const out = svc.applyTemplate('Tienes {{claimsCount}} siniestros', makeCtx({ claimsCount: 0 }));
    expect(out).toBe('Tienes 0 siniestros');
  });

  it('{{insuredId}} expone el uuid', () => {
    const out = svc.applyTemplate('id={{insuredId}}', makeCtx());
    expect(out).toBe('id=11111111-1111-1111-1111-111111111111');
  });

  it('placeholders no soportados quedan literales', () => {
    const out = svc.applyTemplate('{{unknown}} {{validTo}}', makeCtx());
    expect(out).toContain('{{unknown}}');
    expect(out).not.toContain('{{validTo}}');
  });

  it('idempotente: aplicar dos veces produce el mismo output', () => {
    const tpl = 'Tu póliza vence el {{validTo}}, {{firstName}}.';
    const ctx = makeCtx();
    const a = svc.applyTemplate(tpl, ctx);
    const b = svc.applyTemplate(tpl, ctx);
    expect(a).toBe(b);
  });

  it('reemplaza ocurrencias múltiples del mismo placeholder', () => {
    const out = svc.applyTemplate('{{firstName}}, {{firstName}}, {{firstName}}!', makeCtx());
    expect(out).toBe('Juan, Juan, Juan!');
  });
});

describe('PersonalizationService.fillPlaceholders (con Prisma mock)', () => {
  it('arma context desde Prisma y aplica template', async () => {
    const { svc, insuredFindUnique } = makeService();
    insuredFindUnique.mockResolvedValueOnce({
      id: 'i1',
      fullName: 'Ana López',
      validFrom: new Date('2026-01-15T12:00:00Z'),
      validTo: new Date('2027-01-15T12:00:00Z'),
      package: {
        name: 'Plan Oro',
        coverages: [{ name: 'Cobertura A' }, { name: 'Cobertura B' }],
      },
      claims: [{ id: 'c1' }],
    });
    const out = await svc.fillPlaceholders(
      'Hola {{firstName}}, paquete {{packageName}}, {{coveragesCount}} coberturas, vence {{validTo}}.',
      'i1',
    );
    expect(out).toContain('Hola Ana');
    expect(out).toContain('Plan Oro');
    expect(out).toContain('2 coberturas');
    expect(out).toContain('15 de enero de 2027');
  });

  it('insured sin paquete → packageName "—" y count 0', async () => {
    const { svc, insuredFindUnique } = makeService();
    insuredFindUnique.mockResolvedValueOnce({
      id: 'i2',
      fullName: 'Sin Paquete',
      validFrom: new Date('2026-02-01T12:00:00Z'),
      validTo: new Date('2027-02-01T12:00:00Z'),
      package: null,
      claims: [],
    });
    const out = await svc.fillPlaceholders(
      '{{packageName}} / {{coveragesList}} / claims={{claimsCount}}',
      'i2',
    );
    expect(out).toBe('— / — / claims=0');
  });

  it('insured no existe → NotFoundException', async () => {
    const { svc, insuredFindUnique } = makeService();
    insuredFindUnique.mockResolvedValueOnce(null);
    await expect(svc.fillPlaceholders('{{fullName}}', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('fullName de una sola palabra → firstName == fullName', async () => {
    const { svc, insuredFindUnique } = makeService();
    insuredFindUnique.mockResolvedValueOnce({
      id: 'i3',
      fullName: 'Madonna',
      validFrom: new Date('2026-01-01T12:00:00Z'),
      validTo: new Date('2027-01-01T12:00:00Z'),
      package: { name: 'X', coverages: [] },
      claims: [],
    });
    const out = await svc.fillPlaceholders('{{firstName}}={{fullName}}', 'i3');
    expect(out).toBe('Madonna=Madonna');
  });
});
