import type { Logger } from "nestjs-pino";

const EXIT_FLUSH_DELAY_MS = 100;

export const createUncaughtExceptionHandler =
  (
    logger: Logger,
    exit: (code: number) => void,
    delayMs: number = EXIT_FLUSH_DELAY_MS,
  ): ((error: Error) => void) =>
  (error: Error): void => {
    logger.error({ err: error }, "Необработанное исключение — процесс будет остановлен");
    setTimeout(() => exit(1), delayMs);
  };

export function registerProcessErrorHandlers(logger: Logger): void {
  process.on("unhandledRejection", (reason: unknown) => {
    logger.error({ err: reason }, "Необработанный promise rejection");
  });

  process.on(
    "uncaughtException",
    createUncaughtExceptionHandler(logger, (code) => process.exit(code)),
  );
}
