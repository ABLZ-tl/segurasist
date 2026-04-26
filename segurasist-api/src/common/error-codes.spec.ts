import { buildProblem, ERROR_DOCS_BASE, ErrorCodes } from './error-codes';

describe('error-codes / buildProblem', () => {
  it('construye un ProblemDetails con shape RFC 7807 completa', () => {
    const p = buildProblem('VALIDATION_ERROR', 'campo X invalido', 'trace-1', {
      instance: '/v1/insureds',
    });
    expect(p).toEqual({
      type: `${ERROR_DOCS_BASE}/VALIDATION_ERROR`,
      title: ErrorCodes.VALIDATION_ERROR.title,
      status: ErrorCodes.VALIDATION_ERROR.status,
      detail: 'campo X invalido',
      code: 'VALIDATION_ERROR',
      traceId: 'trace-1',
      instance: '/v1/insureds',
    });
  });

  it('soporta extras `field` y `errors` para validation errors estructurados', () => {
    const p = buildProblem('VALIDATION_ERROR', 'detail', 'trace', {
      field: 'email',
      errors: [{ path: 'email', message: 'invalid' }],
    });
    expect(p.field).toBe('email');
    expect(p.errors).toEqual([{ path: 'email', message: 'invalid' }]);
  });

  it.each(Object.entries(ErrorCodes))('mapea correctamente status/title de %s', (code, meta) => {
    const p = buildProblem(code as keyof typeof ErrorCodes, 'msg', 'tid');
    expect(p.status).toBe(meta.status);
    expect(p.title).toBe(meta.title);
    expect(p.code).toBe(code);
    expect(p.type).toBe(`${ERROR_DOCS_BASE}/${code}`);
  });
});
