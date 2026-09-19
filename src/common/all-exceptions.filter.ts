import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();

    if (response.raw.headersSent) {
      this.logger.error({ err: exception }, "Ошибка после отправки ответа клиенту");
      return;
    }

    if (exception instanceof HttpException) {
      if (exception.getStatus() >= 500) {
        this.logger.error(
          { err: exception, statusCode: exception.getStatus() },
          "Ошибка сервера в обработчике запроса",
        );
      }
      response.status(exception.getStatus()).send(exception.getResponse());
      return;
    }

    const statusCode = extractErrorStatusCode(exception);
    if (statusCode !== undefined) {
      if (statusCode >= 500) {
        this.logger.error({ err: exception, statusCode }, "Ошибка сервера в обработчике запроса");
      }
      const message =
        statusCode < 500 && isTrustedStatusError(exception)
          ? exception.message
          : genericStatusMessage(statusCode);
      response.status(statusCode).send({ statusCode, message });
      return;
    }

    this.logger.error({ err: exception }, "Необработанная ошибка запроса");
    response.status(500).send({ statusCode: 500, message: "Internal Server Error" });
  }
}

const TRUSTED_MULTIPART_ERROR_CODES = new Set([
  "FST_REQ_FILE_TOO_LARGE",
  "FST_PARTS_LIMIT",
  "FST_FILES_LIMIT",
  "FST_FIELDS_LIMIT",
  "FST_PROTO_VIOLATION",
  "FST_INVALID_MULTIPART_CONTENT_TYPE",
  "FST_INVALID_JSON_FIELD_ERROR",
  "FST_MP_PREMATURE_CLOSE",
]);

function isTrustedStatusError(exception: unknown): exception is Error & { statusCode: number } {
  if (!(exception instanceof Error)) return false;

  const { code } = exception as { code?: unknown };
  if (typeof code !== "string") return false;
  return code.startsWith("FST_ERR_") || TRUSTED_MULTIPART_ERROR_CODES.has(code);
}

function genericStatusMessage(statusCode: number): string {
  return statusCode < 500 ? "Bad Request" : "Internal Server Error";
}

function extractErrorStatusCode(exception: unknown): number | undefined {
  if (typeof exception !== "object" || exception === null) return undefined;

  const { statusCode } = exception as { statusCode?: unknown };
  if (typeof statusCode !== "number" || statusCode < 400 || statusCode > 599) {
    return undefined;
  }

  return statusCode;
}
