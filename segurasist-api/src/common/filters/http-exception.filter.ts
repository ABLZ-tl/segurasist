import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  NotImplementedException,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { buildProblem, ErrorCode, ErrorCodes, ProblemDetails } from '../error-codes';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();
    const traceId = (req.id as string | undefined) ?? 'unknown';
    const instance = req.url;

    const problem = this.toProblem(exception, traceId, instance);

    if (problem.status >= 500) {
      this.logger.error({ err: exception, traceId, instance }, problem.detail ?? problem.title);
    } else {
      this.logger.warn({ traceId, instance, code: problem.code }, problem.title);
    }

    void res
      .status(problem.status)
      .header('content-type', 'application/problem+json; charset=utf-8')
      .header('x-trace-id', traceId)
      .send(problem);
  }

  private toProblem(exception: unknown, traceId: string, instance: string): ProblemDetails {
    if (exception instanceof ZodError) {
      return buildProblem('VALIDATION_ERROR', 'Input no cumple el esquema', traceId, {
        instance,
        errors: exception.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    if (exception instanceof NotImplementedException) {
      return buildProblem('NOT_IMPLEMENTED', exception.message, traceId, { instance });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = mapHttpStatusToCode(status);
      const response = exception.getResponse();
      const detail =
        typeof response === 'string'
          ? response
          : (((response as { message?: unknown }).message as string | undefined) ?? exception.message);
      return buildProblem(code, detail, traceId, { instance });
    }

    return buildProblem(
      'INTERNAL_ERROR',
      exception instanceof Error ? exception.message : 'Unexpected error',
      traceId,
      { instance },
    );
  }
}

function mapHttpStatusToCode(status: number): ErrorCode {
  switch (status as HttpStatus) {
    case HttpStatus.UNAUTHORIZED:
      return 'AUTH_INVALID_TOKEN';
    case HttpStatus.FORBIDDEN:
      return 'AUTH_INSUFFICIENT_SCOPE';
    case HttpStatus.NOT_FOUND:
      return 'RESOURCE_NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'INSURED_DUPLICATED';
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return 'BATCH_TOO_LARGE';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'VALIDATION_ERROR';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    case HttpStatus.NOT_IMPLEMENTED:
      return 'NOT_IMPLEMENTED';
    case HttpStatus.BAD_GATEWAY:
      return 'UPSTREAM_AWS_ERROR';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR';
  }
}

// Mantener export para evitar warning si no se usa todavía:
export { ErrorCodes };
