import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string | string[];
  path: string;
  timestamp: string;
  [key: string]: unknown;
}

const STATUS_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: "VALIDATION_FAILED",
  [HttpStatus.UNAUTHORIZED]: "UNAUTHENTICATED",
  [HttpStatus.FORBIDDEN]: "FORBIDDEN",
  [HttpStatus.NOT_FOUND]: "NOT_FOUND",
  [HttpStatus.CONFLICT]: "CONFLICT",
  [HttpStatus.PRECONDITION_FAILED]: "VERSION_CONFLICT",
  [HttpStatus.PAYLOAD_TOO_LARGE]: "PAYLOAD_TOO_LARGE",
  [HttpStatus.UNPROCESSABLE_ENTITY]: "UNPROCESSABLE",
  [HttpStatus.TOO_MANY_REQUESTS]: "RATE_LIMITED",
  [HttpStatus.REQUEST_TIMEOUT]: "TIMEOUT",
  [HttpStatus.SERVICE_UNAVAILABLE]: "UNAVAILABLE",
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ url?: string }>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const body: ErrorBody = {
      statusCode: status,
      ...this.resolveExtra(exception, status),
      code: this.resolveCode(exception, status),
      message: this.resolveMessage(exception, status),
      path: httpAdapter.getRequestUrl(request) as string,
      timestamp: new Date().toISOString(),
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${body.code} ${body.path}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // Any 429 that knows its wait time also sends it as the standard header, so
    // clients do not have to special-case each error body.
    if (typeof body.retryAfter === "number") {
      httpAdapter.setHeader(
        ctx.getResponse(),
        "Retry-After",
        String(body.retryAfter),
      );
    }

    httpAdapter.reply(ctx.getResponse(), body, status);
  }

  private resolveExtra(
    exception: unknown,
    status: number,
  ): Record<string, unknown> {
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) return {};
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === "object" && response !== null) {
        const {
          code: _c,
          message: _m,
          ...rest
        } = response as Record<string, unknown>;
        return rest;
      }
    }
    return {};
  }

  private resolveCode(exception: unknown, status: number): string {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (
        typeof response === "object" &&
        response !== null &&
        typeof (response as { code?: unknown }).code === "string"
      ) {
        return (response as { code: string }).code;
      }
    }
    return STATUS_CODES[status] ?? "INTERNAL_ERROR";
  }

  private resolveMessage(
    exception: unknown,
    status: number,
  ): string | string[] {
    // Never surface an unexpected error's message: it can carry connection
    // strings, SQL or file paths.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      return "Internal server error";
    }
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === "string") {
        return response;
      }
      const message = (response as { message?: unknown }).message;
      if (typeof message === "string" || Array.isArray(message)) {
        return message as string | string[];
      }
      return exception.message;
    }
    return "Unexpected error";
  }
}
