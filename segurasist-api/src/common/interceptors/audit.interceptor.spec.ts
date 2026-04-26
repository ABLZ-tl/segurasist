import type { CallHandler } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { mockHttpContext } from '../../../test/mocks/execution-context.mock';
import { AuditInterceptor } from './audit.interceptor';

describe('AuditInterceptor', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('loggea mutaciones POST con tenantId, actorId, method, url y latencyMs', async () => {
    const interceptor = new AuditInterceptor();
    const ctx = mockHttpContext({
      id: 'tid-1',
      method: 'POST',
      url: '/v1/insureds',
      tenant: { id: 'tenant-x' },
      user: { id: 'user-y' },
    });
    const handler: CallHandler = { handle: () => of('done') };
    await firstValueFrom(interceptor.intercept(ctx, handler));
    expect(logSpy).toHaveBeenCalledTimes(1);
    const arg = logSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      traceId: 'tid-1',
      tenantId: 'tenant-x',
      actorId: 'user-y',
      method: 'POST',
      url: '/v1/insureds',
    });
    expect(typeof arg.latencyMs).toBe('number');
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('NO loggea cuando el método es %s (read-only)', async (method) => {
    const interceptor = new AuditInterceptor();
    const ctx = mockHttpContext({ id: 'tid', method, url: '/v1/x' });
    const handler: CallHandler = { handle: () => of('x') };
    await firstValueFrom(interceptor.intercept(ctx, handler));
    expect(logSpy).not.toHaveBeenCalled();
  });

  it.each(['PATCH', 'PUT', 'DELETE'])('SÍ loggea cuando el método es %s (mutación)', async (method) => {
    const interceptor = new AuditInterceptor();
    const ctx = mockHttpContext({ id: 'tid', method, url: '/v1/x' });
    const handler: CallHandler = { handle: () => of('x') };
    await firstValueFrom(interceptor.intercept(ctx, handler));
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('loggea con tenantId/actorId undefined cuando no están en el request', async () => {
    const interceptor = new AuditInterceptor();
    const ctx = mockHttpContext({ id: 'tid', method: 'POST', url: '/v1/y' });
    const handler: CallHandler = { handle: () => of('x') };
    await firstValueFrom(interceptor.intercept(ctx, handler));
    const arg = logSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.tenantId).toBeUndefined();
    expect(arg.actorId).toBeUndefined();
  });
});
