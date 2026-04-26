import type { CallHandler } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { mockHttpContext } from '../../../test/mocks/execution-context.mock';
import { AuditInterceptor, __test } from './audit.interceptor';

describe('AuditInterceptor (Sprint 1 — H2 persistencia)', () => {
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
      ip: '1.2.3.4',
      headers: { 'user-agent': 'jest' },
      body: { fullName: 'Juan' },
    });
    const handler: CallHandler = { handle: () => of('done') };
    await firstValueFrom(interceptor.intercept(ctx, handler));
    expect(logSpy).toHaveBeenCalled();
    const arg = logSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      traceId: 'tid-1',
      tenantId: 'tenant-x',
      actorId: 'user-y',
      method: 'POST',
      url: '/v1/insureds',
      action: 'create',
      resourceType: 'insureds',
    });
    expect(typeof arg.latencyMs).toBe('number');
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('NO loggea cuando el método es %s (read-only)', async (method) => {
    const interceptor = new AuditInterceptor();
    const ctx = mockHttpContext({
      id: 'tid',
      method,
      url: '/v1/x',
      tenant: { id: 't' },
    });
    const handler: CallHandler = { handle: () => of('x') };
    await firstValueFrom(interceptor.intercept(ctx, handler));
    expect(logSpy).not.toHaveBeenCalled();
  });

  it.each(['PATCH', 'PUT', 'DELETE'])('SÍ loggea cuando el método es %s (mutación)', async (method) => {
    const interceptor = new AuditInterceptor();
    const ctx = mockHttpContext({
      id: 'tid',
      method,
      url: '/v1/x',
      tenant: { id: 't' },
      headers: {},
    });
    const handler: CallHandler = { handle: () => of('x') };
    await firstValueFrom(interceptor.intercept(ctx, handler));
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('loggea con tenantId/actorId undefined cuando no están en el request', async () => {
    const interceptor = new AuditInterceptor();
    const ctx = mockHttpContext({ id: 'tid', method: 'POST', url: '/v1/y', headers: {} });
    const handler: CallHandler = { handle: () => of('x') };
    await firstValueFrom(interceptor.intercept(ctx, handler));
    const arg = logSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.tenantId).toBeUndefined();
    expect(arg.actorId).toBeUndefined();
  });

  it('persiste vía AuditWriterService cuando hay tenantId', async () => {
    const writer = { record: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new AuditInterceptor(writer as never);
    const ctx = mockHttpContext({
      id: 'tid',
      method: 'POST',
      url: '/v1/insureds',
      tenant: { id: 'tenant-z' },
      user: { id: 'u1' },
      ip: '8.8.8.8',
      headers: { 'user-agent': 'ua' },
      body: { fullName: 'X', password: 'super-secret' },
    });
    const handler: CallHandler = { handle: () => of({ id: 'created' }) };
    await firstValueFrom(interceptor.intercept(ctx, handler));
    expect(writer.record).toHaveBeenCalledTimes(1);
    const ev = writer.record.mock.calls[0][0];
    expect(ev).toMatchObject({
      tenantId: 'tenant-z',
      actorId: 'u1',
      action: 'create',
      resourceType: 'insureds',
      ip: '8.8.8.8',
      userAgent: 'ua',
      traceId: 'tid',
    });
    // payloadDiff redactado: password no debe filtrar.
    expect(JSON.stringify(ev.payloadDiff)).not.toContain('super-secret');
    expect(JSON.stringify(ev.payloadDiff)).toContain('[REDACTED]');
  });

  it('NO persiste cuando tenantId es undefined (login pre-auth) pero sigue logueando', async () => {
    const writer = { record: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new AuditInterceptor(writer as never);
    const ctx = mockHttpContext({
      id: 'tid',
      method: 'POST',
      url: '/v1/auth/login',
      headers: {},
      body: { email: 'a@b.c', password: 'x' },
    });
    const handler: CallHandler = { handle: () => of({ accessToken: 'jwt' }) };
    await firstValueFrom(interceptor.intercept(ctx, handler));
    expect(writer.record).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it('action mapping: DELETE → delete, PATCH → update, /reissue → reissue', async () => {
    const writer = { record: jest.fn().mockResolvedValue(undefined) };

    const cases = [
      { method: 'DELETE', url: '/v1/insureds/abc', expected: 'delete' },
      { method: 'PATCH', url: '/v1/insureds/abc', expected: 'update' },
      {
        method: 'POST',
        url: '/v1/certificates/00000000-0000-4000-8000-000000000000/reissue',
        expected: 'reissue',
      },
    ];

    for (const c of cases) {
      writer.record.mockClear();
      const interceptor = new AuditInterceptor(writer as never);
      const ctx = mockHttpContext({
        id: 't',
        method: c.method,
        url: c.url,
        tenant: { id: 'tenant-1' },
        headers: {},
      });
      const handler: CallHandler = { handle: () => of('ok') };
      await firstValueFrom(interceptor.intercept(ctx, handler));
      expect(writer.record).toHaveBeenCalledTimes(1);
      expect(writer.record.mock.calls[0][0].action).toBe(c.expected);
    }
  });
});

describe('AuditInterceptor helpers', () => {
  it('redact: scrubea password/token recursivamente y respeta tipos primitivos', () => {
    const out = __test.redact({
      data: { items: [{ password: 'p', name: 'ok', deep: { token: 't' } }] },
      curp: 'PEPM800101HDFRRR01',
    });
    const s = JSON.stringify(out);
    expect(s).not.toContain('"p"');
    expect(s).not.toContain('"t"');
    expect(s).not.toContain('PEPM800101');
    expect(s).toContain('[REDACTED]');
    expect(s).toContain('"name":"ok"');
  });

  it('extractResourceType: descarta el prefijo v1 y devuelve el siguiente segmento', () => {
    expect(__test.extractResourceType('/v1/insureds/abc')).toBe('insureds');
    expect(__test.extractResourceType('/insureds')).toBe('insureds');
    expect(__test.extractResourceType('/v1/batches/uuid/errors')).toBe('batches');
  });

  it('extractResourceId: pesca un UUID si existe en el path', () => {
    expect(__test.extractResourceId('/v1/insureds/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBe(
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    );
    expect(__test.extractResourceId('/v1/insureds')).toBeUndefined();
  });
});
