import type { CallHandler } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { mockHttpContext } from '../../../test/mocks/execution-context.mock';
import { TraceIdInterceptor } from './trace-id.interceptor';

describe('TraceIdInterceptor', () => {
  it('escribe header x-trace-id con req.id en el response', async () => {
    const interceptor = new TraceIdInterceptor();
    const headers: Record<string, string> = {};
    const res = {
      header: (k: string, v: string) => {
        headers[k] = v;
      },
    };
    const ctx = mockHttpContext({ id: 'tid-123' }, res);
    const handler: CallHandler = { handle: () => of('payload') };
    await firstValueFrom(interceptor.intercept(ctx, handler));
    expect(headers['x-trace-id']).toBe('tid-123');
  });

  it('usa "unknown" cuando req.id es undefined', async () => {
    const interceptor = new TraceIdInterceptor();
    const headers: Record<string, string> = {};
    const res = {
      header: (k: string, v: string) => {
        headers[k] = v;
      },
    };
    const ctx = mockHttpContext({ id: undefined }, res);
    const handler: CallHandler = { handle: () => of('payload') };
    await firstValueFrom(interceptor.intercept(ctx, handler));
    expect(headers['x-trace-id']).toBe('unknown');
  });
});
