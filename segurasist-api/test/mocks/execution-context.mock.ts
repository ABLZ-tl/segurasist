import type { ExecutionContext } from '@nestjs/common';

/**
 * Factory de ExecutionContext mock para guards/interceptors HTTP.
 *
 * Devuelve un objeto plano con `switchToHttp().getRequest()` apuntando al
 * request pasado. `getHandler` y `getClass` devuelven funciones identidad para
 * que `Reflector.getAllAndOverride(...)` reciba algo (los tests stubean
 * Reflector directo cuando importa).
 */
export function mockHttpContext<TReq extends Record<string, unknown> = Record<string, unknown>>(
  request: TReq,
  response: Record<string, unknown> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => request as unknown as T,
      getResponse: <T>() => response as unknown as T,
      getNext: <T>() => undefined as unknown as T,
    }),
    getHandler: () => function handler() {},
    getClass: () => class Cls {},
    getArgs: () => [] as unknown as Parameters<ExecutionContext['getArgs']>,
    getArgByIndex: () => undefined as unknown,
    switchToRpc: () => ({ getData: () => ({}), getContext: () => ({}) }),
    switchToWs: () => ({ getClient: () => ({}), getData: () => ({}), getPattern: () => '' }),
    getType: () => 'http',
  } as unknown as ExecutionContext;
}
