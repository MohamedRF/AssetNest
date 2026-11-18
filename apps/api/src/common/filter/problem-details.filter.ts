import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import { ZodError } from 'zod';
import type { Request, Response } from 'express';
import { CorrelationContext } from '../correlation.middleware.js';
import { JsonLoggerService } from '../logging/json-logger.service.js';

export interface ProblemDetails {
  /** Always 'about:blank' — we do not mint per-error URIs yet. */
  type: 'about:blank';
  title: string;
  status: number;
  detail: string;
  /** Request path the problem occurred on. */
  instance: string;
  /** Stable machine-readable code, e.g. VALIDATION_FAILED. */
  code: string;
  requestId: string;
}

const GENERIC_500_DETAIL = 'Internal server error';
const MAX_DETAIL_LENGTH = 500;

function truncate(value: string): string {
  return value.length > MAX_DETAIL_LENGTH ? `${value.slice(0, MAX_DETAIL_LENGTH)}…` : value;
}

function titleFor(status: number): string {
  return STATUS_CODES[status] ?? 'Error';
}

/**
 * Global exception filter. Maps every thrown value to an RFC 7807-style
 * problem-details body. Never leaks stack traces or internal error text for
 * 5xx responses; unexpected errors are logged server-side with the request id.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new JsonLoggerService('ProblemDetailsFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const instance = typeof request?.url === 'string' ? request.url : '';
    const requestId = CorrelationContext.getRequestId() ?? 'unknown';

    const problem = this.toProblemDetails(exception, instance, requestId);

    if (problem.status >= 500) {
      this.logger.error(
        'Unhandled exception',
        exception instanceof Error ? exception : String(exception),
        'ProblemDetailsFilter',
      );
    }

    response.status(problem.status).json(problem);
  }

  private toProblemDetails(exception: unknown, instance: string, requestId: string): ProblemDetails {
    if (exception instanceof ZodError) {
      return {
        type: 'about:blank',
        title: titleFor(HttpStatus.BAD_REQUEST),
        status: HttpStatus.BAD_REQUEST,
        detail: truncate(this.formatZodIssues(exception)),
        instance,
        code: 'VALIDATION_FAILED',
        requestId,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) {
        // Preserve the status code but never the internal message.
        return {
          type: 'about:blank',
          title: titleFor(status),
          status,
          detail: GENERIC_500_DETAIL,
          instance,
          code: `HTTP_${status}`,
          requestId,
        };
      }
      const { detail, code } = this.describeHttpException(exception, status);
      return {
        type: 'about:blank',
        title: titleFor(status),
        status,
        detail,
        instance,
        code: code ?? `HTTP_${status}`,
        requestId,
      };
    }

    return this.internalError(instance, requestId);
  }

  private internalError(instance: string, requestId: string): ProblemDetails {
    return {
      type: 'about:blank',
      title: titleFor(HttpStatus.INTERNAL_SERVER_ERROR),
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: GENERIC_500_DETAIL,
      instance,
      code: 'INTERNAL_ERROR',
      requestId,
    };
  }

  private formatZodIssues(error: ZodError): string {
    const parts = error.issues.map((issue) => {
      const path = issue.path.join('.') || '(root)';
      return `${path}: ${issue.message}`;
    });
    return parts.length > 0 ? parts.join('; ') : 'Validation failed';
  }

  private describeHttpException(exception: HttpException, status: number): { detail: string; code?: string } {
    const body = exception.getResponse();
    if (typeof body === 'string') {
      return { detail: truncate(body) };
    }
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      const message = record.message;
      let detail: string | undefined;
      if (typeof message === 'string') {
        detail = message;
      } else if (Array.isArray(message)) {
        detail = message.filter((m): m is string => typeof m === 'string').join('; ');
      }
      const code = typeof record.code === 'string' ? record.code : undefined;
      if (!detail || detail.length === 0) {
        detail = typeof record.error === 'string' ? record.error : titleFor(status);
      }
      return { detail: truncate(detail), code };
    }
    return { detail: titleFor(status) };
  }
}
