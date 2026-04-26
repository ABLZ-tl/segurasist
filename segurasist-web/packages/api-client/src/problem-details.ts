/**
 * RFC 7807 Problem Details. The backend always returns `application/problem+json`
 * for non-2xx responses. We translate generic codes to user-friendly Spanish
 * messages where possible; everything else falls back to `title` from the body.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
  errors?: Array<{ field?: string; message: string }>;
}

const HUMAN_MESSAGES: Record<string, string> = {
  CURP_INVALID: 'CURP inválido: dígito verificador no coincide.',
  RFC_INVALID: 'RFC inválido. Verifica el formato.',
  AUTH_REQUIRED: 'Necesitas iniciar sesión para continuar.',
  AUTH_EXPIRED: 'Tu sesión ha expirado. Inicia sesión nuevamente.',
  AUTH_FORBIDDEN: 'No tienes permisos para realizar esta acción.',
  POLICY_NOT_FOUND: 'No encontramos una póliza con esos datos.',
  CERTIFICATE_NOT_FOUND: 'El certificado solicitado no existe.',
  RATE_LIMITED: 'Demasiadas solicitudes. Espera un momento.',
};

export class ProblemDetailsError extends Error {
  readonly status: number;
  readonly traceId: string;
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails, traceId: string) {
    super(ProblemDetailsError.humanMessage(problem));
    this.name = 'ProblemDetailsError';
    this.status = problem.status;
    this.traceId = traceId;
    this.problem = problem;
  }

  static async from(res: Response, traceId: string): Promise<ProblemDetailsError> {
    let problem: ProblemDetails;
    try {
      problem = (await res.json()) as ProblemDetails;
    } catch {
      problem = {
        type: 'about:blank',
        title: res.statusText || 'Error de red',
        status: res.status,
      };
    }
    return new ProblemDetailsError(problem, traceId);
  }

  static humanMessage(problem: ProblemDetails): string {
    if (problem.code && HUMAN_MESSAGES[problem.code]) {
      return HUMAN_MESSAGES[problem.code]!;
    }
    return problem.detail ?? problem.title ?? 'Ocurrió un error inesperado.';
  }
}
