import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { FastifyReply } from "fastify";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();

    if (response.sent) {
      this.logger.error({ err: exception }, "Ошибка после отправки ответа клиенту");
      return;
    }

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).send(exception.getResponse());
      return;
    }

    const statusCode = extractErrorStatusCode(exception);
    if (statusCode !== undefined) {
      response.status(statusCode).send({
        statusCode,
        message: exception instanceof Error ? exception.message : "Request failed",
      });
      return;
    }

    this.logger.error({ err: exception }, "Необработанная ошибка запроса");
    response.status(500).send({ statusCode: 500, message: "Internal Server Error" });
  }
}

function extractErrorStatusCode(exception: unknown): number | undefined {
  if (typeof exception !== "object" || exception === null) return undefined;

  const { statusCode } = exception as { statusCode?: unknown };
  if (typeof statusCode !== "number" || statusCode < 400 || statusCode > 599) {
    return undefined;
  }

  return statusCode;
}
