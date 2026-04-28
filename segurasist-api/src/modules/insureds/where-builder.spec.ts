/**
 * H-17 — Tests del builder compartido `buildInsuredsWhere`. Garantizan que
 * los 3 callers (`list`, `buildExportWhere`, `reports-worker.queryInsureds`)
 * obtengan la misma forma de WHERE clause.
 */
import { buildInsuredsWhere } from './where-builder';

describe('buildInsuredsWhere (H-17)', () => {
  it('default: filtra deletedAt=null sin OR ni rangos', () => {
    const where = buildInsuredsWhere({});
    expect(where).toEqual({ deletedAt: null });
  });

  it('q produce OR con 4 entradas en el orden esperado', () => {
    const where = buildInsuredsWhere({ q: 'Lopez' });
    expect(where.deletedAt).toBeNull();
    expect(Array.isArray(where.OR)).toBe(true);
    const or = where.OR as unknown[];
    expect(or).toHaveLength(4);
    expect(or[0]).toMatchObject({ fullName: { contains: 'Lopez', mode: 'insensitive' } });
    expect(or[1]).toMatchObject({ curp: { contains: 'LOPEZ' } });
    expect(or[2]).toMatchObject({ rfc: { contains: 'LOPEZ' } });
    expect(or[3]).toMatchObject({
      metadata: { path: ['numeroEmpleadoExterno'], string_contains: 'Lopez' },
    });
  });

  it('q se aplica trim antes del search', () => {
    const where = buildInsuredsWhere({ q: '  hernan  ' });
    const or = where.OR as Array<{ fullName?: { contains?: string } }>;
    expect(or[0]?.fullName?.contains).toBe('hernan');
  });

  it('status, packageId pasan como eq filter', () => {
    const where = buildInsuredsWhere({ status: 'active', packageId: 'pkg-1' });
    expect(where.status).toBe('active');
    expect(where.packageId).toBe('pkg-1');
    expect(where.OR).toBeUndefined();
  });

  it('validFromGte/Lte construyen rango Date', () => {
    const where = buildInsuredsWhere({
      validFromGte: '2026-01-01',
      validFromLte: '2026-12-31',
    });
    const range = where.validFrom as { gte: Date; lte: Date };
    expect(range.gte).toBeInstanceOf(Date);
    expect(range.lte).toBeInstanceOf(Date);
    expect(range.gte.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('validToGte/Lte construyen rango Date independiente', () => {
    const where = buildInsuredsWhere({
      validToGte: '2026-06-01',
      validToLte: '2026-06-30',
    });
    const range = where.validTo as { gte: Date; lte: Date };
    expect(range.gte.toISOString().slice(0, 10)).toBe('2026-06-01');
    expect(range.lte.toISOString().slice(0, 10)).toBe('2026-06-30');
  });

  it('rangos vacíos no aparecen en where', () => {
    const where = buildInsuredsWhere({ q: 'x' });
    expect(where.validFrom).toBeUndefined();
    expect(where.validTo).toBeUndefined();
  });

  it('filtros combinados (q + status + ranges) son shape predecible', () => {
    const where = buildInsuredsWhere({
      q: 'maria',
      status: 'active',
      packageId: 'pkg-2',
      validFromGte: '2026-01-01',
      validToLte: '2026-12-31',
    });
    expect(where.deletedAt).toBeNull();
    expect(where.status).toBe('active');
    expect(where.packageId).toBe('pkg-2');
    expect(Array.isArray(where.OR)).toBe(true);
    const validFrom = where.validFrom as { gte?: Date; lte?: Date };
    const validTo = where.validTo as { gte?: Date; lte?: Date };
    expect(validFrom.gte).toBeInstanceOf(Date);
    expect(validFrom.lte).toBeUndefined();
    expect(validTo.gte).toBeUndefined();
    expect(validTo.lte).toBeInstanceOf(Date);
  });

  it('NO incluye tenantId (caller-scoped) ni cursor', () => {
    const where = buildInsuredsWhere({ q: 'x', status: 'active' });
    // tenantId lo aplica el caller (RLS o filter explícito en worker).
    expect((where as { tenantId?: unknown }).tenantId).toBeUndefined();
    // El builder no maneja paginación.
    expect((where as { AND?: unknown }).AND).toBeUndefined();
  });
});
