import type { CallHandler } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { mockHttpContext } from '../../../test/mocks/execution-context.mock';
import { TenantOverrideAuditInterceptor } from './tenant-override-audit.interceptor';

describe('TenantOverrideAuditInterceptor (S3-08)', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());

  it('persiste tenant.override.used en GET cuando override está activo', async () => {
    const writer = { recordOverrideUse: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new TenantOverrideAuditInterceptor(writer as never);
    const ctx = mockHttpContext({
      id: 'trace-1',
      method: 'GET',
      url: '/v1/insureds',
      ip: '1.2.3.4',
      headers: { 'user-agent': 'curl' },
      user: { id: 'super-1' },
      tenantOverride: { active: true, overrideTenant: 'tenant-mac' },
    });
    const handler: CallHandler = { handle: () => of([]) };
    await firstValueFrom(interceptor.intercept(ctx, handler));
    expect(writer.recordOverrideUse).toHaveBeenCalledWith({
      actorId: 'super-1',
      overrideTenant: 'tenant-mac',
      ip: '1.2.3.4',
      userAgent: 'curl',
      requestPath: '/v1/insureds',
      traceId: 'trace-1',
    });
  });

  it('NO persiste cuando override no está activo', async () => {
    const writer = { recordOverrideUse: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new TenantOverrideAuditInterceptor(writer as never);
    const ctx = mockHttpContext({
      method: 'GET',
      url: '/v1/insureds',
      headers: {},
      user: { id: 'super-1' },
    });
    const handler: CallHandler = { handle: () => of([]) };
    await firstValueFrom(interceptor.intercept(ctx, handler));
    expect(writer.recordOverrideUse).not.toHaveBeenCalled();
  });

  it('NO persiste en mutaciones (POST/PATCH/DELETE) — el AuditInterceptor estándar ya cubre _overrideTenant', async () => {
    const writer = { recordOverrideUse: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new TenantOverrideAuditInterceptor(writer as never);
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      writer.recordOverrideUse.mockClear();
      const ctx = mockHttpContext({
        method,
        url: '/v1/insureds',
        headers: {},
        user: { id: 'super-1' },
        tenantOverride: { active: true, overrideTenant: 'tenant-mac' },
      });
      const handler: CallHandler = { handle: () => of('done') };
      await firstValueFrom(interceptor.intercept(ctx, handler));
      expect(writer.recordOverrideUse).not.toHaveBeenCalled();
    }
  });

  it('persiste en HEAD también (GET y HEAD ambos son reads)', async () => {
    const writer = { recordOverrideUse: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new TenantOverrideAuditInterceptor(writer as never);
    const ctx = mockHttpContext({
      method: 'HEAD',
      url: '/v1/insureds',
      headers: {},
      user: { id: 'super-1' },
      tenantOverride: { active: true, overrideTenant: 'tenant-mac' },
    });
    const handler: CallHandler = { handle: () => of([]) };
    await firstValueFrom(interceptor.intercept(ctx, handler));
    expect(writer.recordOverrideUse).toHaveBeenCalledTimes(1);
  });

  it('si writer no está inyectado, sólo loguea sin tirar', async () => {
    const interceptor = new TenantOverrideAuditInterceptor();
    const ctx = mockHttpContext({
      method: 'GET',
      url: '/v1/insureds',
      headers: {},
      user: { id: 'super-1' },
      tenantOverride: { active: true, overrideTenant: 'tenant-mac' },
    });
    const handler: CallHandler = { handle: () => of([]) };
    await expect(firstValueFrom(interceptor.intercept(ctx, handler))).resolves.toBeDefined();
    expect(logSpy).toHaveBeenCalled();
  });

  it('log estructurado contiene event=tenant.override.used', async () => {
    const writer = { recordOverrideUse: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new TenantOverrideAuditInterceptor(writer as never);
    const ctx = mockHttpContext({
      method: 'GET',
      url: '/v1/insureds',
      headers: {},
      user: { id: 'super-1' },
      tenantOverride: { active: true, overrideTenant: 'tenant-mac' },
    });
    const handler: CallHandler = { handle: () => of([]) };
    await firstValueFrom(interceptor.intercept(ctx, handler));
    const matched = logSpy.mock.calls.some((call: unknown[]) =>
      call.some((arg: unknown) => {
        if (typeof arg !== 'object' || arg === null) return false;
        const o = arg as Record<string, unknown>;
        return o.event === 'tenant.override.used' && o.overrideTenant === 'tenant-mac';
      }),
    );
    expect(matched).toBe(true);
  });
});
