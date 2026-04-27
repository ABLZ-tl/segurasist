import { ForbiddenException, NotImplementedException } from '@nestjs/common';
import { TenantsService } from './tenants.service';

describe('TenantsService (M2 — superadmin via PrismaBypassRlsService)', () => {
  function makeBypass(opts: { enabled: boolean; rows?: unknown[] } = { enabled: true, rows: [] }) {
    const findMany = jest.fn().mockResolvedValue(opts.rows ?? []);
    const client = { tenant: { findMany } } as unknown;
    return {
      svc: new TenantsService({
        get client() {
          if (!opts.enabled) {
            throw new ForbiddenException('PrismaBypassRlsService no configurado');
          }
          return client;
        },
        isEnabled: () => opts.enabled,
        // No usados pero la interfaz los exige.
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
      } as never),
      findMany,
    };
  }

  it('listActive() devuelve sólo tenants activos con id/name/slug (S3-08)', async () => {
    const rows = [
      { id: 't1', name: 'Hospitales MAC', slug: 'mac' },
      { id: 't2', name: 'Demo', slug: 'demo' },
    ];
    const { svc, findMany } = makeBypass({ enabled: true, rows });
    const out = await svc.listActive();
    expect(findMany).toHaveBeenCalledWith({
      where: { deletedAt: null, status: 'active' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    });
    expect(out).toEqual(rows);
  });

  it('list() consulta tenants vía bypass client', async () => {
    const { svc, findMany } = makeBypass({ enabled: true, rows: [{ id: 't1' }, { id: 't2' }] });
    const out = await svc.list();
    expect(findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(out).toEqual([{ id: 't1' }, { id: 't2' }]);
  });

  it('list() lanza ForbiddenException si el bypass client no está habilitado', async () => {
    const { svc } = makeBypass({ enabled: false });
    await expect((async () => svc.list())()).rejects.toThrow(ForbiddenException);
  });

  it('create lanza NotImplementedException', () => {
    const { svc } = makeBypass();
    expect(() => svc.create()).toThrow(NotImplementedException);
    expect(() => svc.create()).toThrow('TenantsService.create');
  });
  it('update lanza NotImplementedException', () => {
    const { svc } = makeBypass();
    expect(() => svc.update()).toThrow('TenantsService.update');
  });
  it('remove lanza NotImplementedException', () => {
    const { svc } = makeBypass();
    expect(() => svc.remove()).toThrow('TenantsService.remove');
  });
});
