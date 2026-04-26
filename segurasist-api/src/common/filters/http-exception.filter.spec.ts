import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  NotImplementedException,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ZodError } from 'zod';
import { z } from 'zod';
import { HttpExceptionFilter } from './http-exception.filter';

interface CapturedReply {
  statusCode?: number;
  headers: Record<string, string>;
  body?: unknown;
}

function buildHost(
  url = '/v1/test',
  traceId: string | undefined = 'trace-xyz',
): { host: ArgumentsHost; reply: CapturedReply } {
  const reply: CapturedReply = { headers: {} };
  const res = {
    status(code: number) {
      reply.statusCode = code;
      return this;
    },
    header(name: string, value: string) {
      reply.headers[name] = value;
      return this;
    },
    send(body: unknown) {
      reply.body = body;
      return this;
    },
  };
  const req = { id: traceId, url };
  const host = {
    switchToHttp: () => ({
      getResponse: <T>() => res as unknown as T,
      getRequest: <T>() => req as unknown as T,
      getNext: <T>() => undefined as unknown as T,
    }),
  } as unknown as ArgumentsHost;
  return { host, reply };
}

function buildHostWithoutId(url: string): { host: ArgumentsHost; reply: CapturedReply } {
  // Wrapper que NO setea req.id (así el filter cae en el fallback "unknown").
  const { host, reply } = buildHost(url, undefined as unknown as string);
  // Forzar id=undefined explícitamente borrando del req.
  const req = host.switchToHttp().getRequest();
  delete req.id;
  return { host, reply };
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();
  // Silenciar logger en pruebas (es ruido y los warns/errors son esperados).
  beforeAll(() => {
    jest
      .spyOn((filter as unknown as { logger: { error: () => void; warn: () => void } }).logger, 'error')
      .mockImplementation(() => undefined);
    jest
      .spyOn((filter as unknown as { logger: { error: () => void; warn: () => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  it('construye problem+json con headers content-type y x-trace-id', () => {
    const { host, reply } = buildHost('/v1/foo', 'tid-1');
    // NB: BadRequest (400) cae en `default` → VALIDATION_ERROR → status 422.
    // El status de HttpException original NO se preserva — se mapea al ErrorCode.
    filter.catch(new BadRequestException('bad'), host);
    expect(reply.statusCode).toBe(422);
    expect(reply.headers['content-type']).toBe('application/problem+json; charset=utf-8');
    expect(reply.headers['x-trace-id']).toBe('tid-1');
    expect((reply.body as { traceId: string }).traceId).toBe('tid-1');
    expect((reply.body as { instance: string }).instance).toBe('/v1/foo');
    expect((reply.body as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('mapea ZodError a VALIDATION_ERROR con array de issues', () => {
    const schema = z.object({ email: z.string().email(), age: z.number().min(18) });
    let zodErr: ZodError | null = null;
    const r = schema.safeParse({ email: 'bad', age: 5 });
    if (!r.success) zodErr = r.error;
    expect(zodErr).not.toBeNull();

    const { host, reply } = buildHost();
    filter.catch(zodErr, host);
    const body = reply.body as {
      code: string;
      status: number;
      errors: Array<{ path: string; message: string }>;
    };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.status).toBe(422);
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThanOrEqual(2);
    expect(body.errors.map((e) => e.path)).toEqual(expect.arrayContaining(['email', 'age']));
  });

  it.each([
    [new UnauthorizedException('nope'), 401, 'AUTH_INVALID_TOKEN'],
    [new ForbiddenException('no scope'), 403, 'AUTH_INSUFFICIENT_SCOPE'],
    [new NotFoundException('missing'), 404, 'RESOURCE_NOT_FOUND'],
    [new ConflictException('dup'), 409, 'INSURED_DUPLICATED'],
    [new PayloadTooLargeException('big'), 413, 'BATCH_TOO_LARGE'],
    [new NotImplementedException('soon'), 501, 'NOT_IMPLEMENTED'],
  ])('mapea %s al code/status correctos', (exception, status, code) => {
    const { host, reply } = buildHost();
    filter.catch(exception, host);
    expect(reply.statusCode).toBe(status);
    expect((reply.body as { code: string }).code).toBe(code);
  });

  it('mapea HttpException 422 a VALIDATION_ERROR', () => {
    const { host, reply } = buildHost();
    filter.catch(new HttpException('boom', 422), host);
    expect(reply.statusCode).toBe(422);
    expect((reply.body as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('mapea HttpException 429 a RATE_LIMITED', () => {
    const { host, reply } = buildHost();
    filter.catch(new HttpException('slow down', 429), host);
    expect(reply.statusCode).toBe(429);
    expect((reply.body as { code: string }).code).toBe('RATE_LIMITED');
  });

  it('mapea HttpException 502 a UPSTREAM_AWS_ERROR', () => {
    const { host, reply } = buildHost();
    filter.catch(new HttpException('upstream', 502), host);
    expect(reply.statusCode).toBe(502);
    expect((reply.body as { code: string }).code).toBe('UPSTREAM_AWS_ERROR');
  });

  it('errores desconocidos (no Error class) → INTERNAL_ERROR 500', () => {
    const { host, reply } = buildHost();
    filter.catch('plain string', host);
    expect(reply.statusCode).toBe(500);
    expect((reply.body as { code: string }).code).toBe('INTERNAL_ERROR');
    expect((reply.body as { detail: string }).detail).toBe('Unexpected error');
  });

  it('Error nativo pasa el message como detail con INTERNAL_ERROR', () => {
    const { host, reply } = buildHost();
    filter.catch(new Error('something broke'), host);
    expect(reply.statusCode).toBe(500);
    expect((reply.body as { code: string; detail: string }).code).toBe('INTERNAL_ERROR');
    expect((reply.body as { detail: string }).detail).toBe('something broke');
  });

  it('sin trace id en el request → traceId="unknown"', () => {
    // buildHost necesita explícitamente borrar el id, default es 'trace-xyz'.
    const { host, reply } = buildHostWithoutId('/v1/x');
    filter.catch(new BadRequestException('x'), host);
    expect((reply.body as { traceId: string }).traceId).toBe('unknown');
    expect(reply.headers['x-trace-id']).toBe('unknown');
  });

  it('5xx genérico (no matcheado) cae en INTERNAL_ERROR (status reescrito a 500)', () => {
    // BUG-O-FEATURE: el status original de la HttpException (503) NO se preserva.
    // El filter mapea via ErrorCode → INTERNAL_ERROR.status = 500.
    const { host, reply } = buildHost();
    filter.catch(new HttpException('weird', 503), host);
    expect((reply.body as { code: string }).code).toBe('INTERNAL_ERROR');
    expect(reply.statusCode).toBe(500);
  });

  it('extrae detail del response object cuando HttpException lo trae con message', () => {
    const exc = new HttpException({ message: 'detalle estructurado', other: 'x' }, 400);
    const { host, reply } = buildHost();
    filter.catch(exc, host);
    expect((reply.body as { detail: string }).detail).toBe('detalle estructurado');
  });
});
