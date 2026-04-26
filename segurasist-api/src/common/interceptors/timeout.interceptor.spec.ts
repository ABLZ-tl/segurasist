import { RequestTimeoutException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, lastValueFrom, Observable, of, throwError } from 'rxjs';
import { TimeoutInterceptor } from './timeout.interceptor';

function execCtx(): ExecutionContext {
  return {} as unknown as ExecutionContext;
}

describe('TimeoutInterceptor', () => {
  it('passthrough cuando el handler responde antes del timeout', async () => {
    const interceptor = new TimeoutInterceptor(50);
    const handler: CallHandler = { handle: () => of('ok') };
    const out = await firstValueFrom(interceptor.intercept(execCtx(), handler));
    expect(out).toBe('ok');
  });

  it('convierte TimeoutError en RequestTimeoutException si el handler nunca emite', async () => {
    jest.useFakeTimers();
    const interceptor = new TimeoutInterceptor(10);
    const handler: CallHandler = {
      handle: () => new Observable<unknown>(() => undefined), // jamás emite
    };
    const obs$ = interceptor.intercept(execCtx(), handler);
    const promise = lastValueFrom(obs$);
    jest.advanceTimersByTime(20);
    await expect(promise).rejects.toThrow(RequestTimeoutException);
    jest.useRealTimers();
  });

  it('re-lanza errores no-timeout sin transformarlos', async () => {
    const interceptor = new TimeoutInterceptor(50);
    const original = new Error('boom');
    const handler: CallHandler = { handle: () => throwError(() => original) };
    await expect(lastValueFrom(interceptor.intercept(execCtx(), handler))).rejects.toBe(original);
  });
});
