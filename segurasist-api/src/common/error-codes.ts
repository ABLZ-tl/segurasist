// Catálogo central de códigos de error (RFC 7807 `code` + mapping a HTTP status).
// Mantener sincronizado con docs/errors/.

export const ERROR_DOCS_BASE = 'https://docs.segurasist.app/errors';

export const ErrorCodes = {
  AUTH_INVALID_TOKEN: { status: 401, title: 'Token inválido' },
  AUTH_INSUFFICIENT_SCOPE: { status: 403, title: 'Scope insuficiente' },
  TENANT_MISMATCH: { status: 403, title: 'Recurso de otro tenant' },
  RESOURCE_NOT_FOUND: { status: 404, title: 'Recurso no encontrado' },
  VALIDATION_ERROR: { status: 422, title: 'Validación fallida' },
  INSURED_DUPLICATED: { status: 409, title: 'Asegurado duplicado' },
  BATCH_TOO_LARGE: { status: 413, title: 'Archivo demasiado grande' },
  UNSUPPORTED_FILE: { status: 415, title: 'Tipo de archivo no soportado' },
  RATE_LIMITED: { status: 429, title: 'Cuota excedida' },
  UPSTREAM_AWS_ERROR: { status: 502, title: 'Error AWS upstream' },
  NOT_IMPLEMENTED: { status: 501, title: 'No implementado' },
  INTERNAL_ERROR: { status: 500, title: 'Error interno' },
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: ErrorCode;
  traceId: string;
  field?: string;
  errors?: Array<{ path: string; message: string }>;
}

export function buildProblem(
  code: ErrorCode,
  detail: string,
  traceId: string,
  extra: Partial<Pick<ProblemDetails, 'instance' | 'field' | 'errors'>> = {},
  /**
   * Status HTTP a forzar. Si se omite, se usa el del catálogo `ErrorCodes`.
   * Útil cuando el upstream lanza `HttpException` con un status que el
   * catálogo no mapea 1-1 (p.ej. 503 Service Unavailable, 418, etc.).
   * El status del problem y el del response HTTP siempre coinciden — el
   * filter usa este número para `res.status(...)`.
   */
  statusOverride?: number,
): ProblemDetails {
  const meta = ErrorCodes[code];
  return {
    type: `${ERROR_DOCS_BASE}/${code}`,
    title: meta.title,
    status: statusOverride ?? meta.status,
    detail,
    code,
    traceId,
    ...extra,
  };
}
