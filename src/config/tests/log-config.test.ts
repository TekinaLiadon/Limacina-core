import pino from "pino";
import { describe, expect, it } from "bun:test";
import LogConfig from "../log-config";

const PINO_LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;

const baseEnv = { NODE_ENV: "development" };

describe("LogConfig LOG_LEVEL", (): void => {
  it("info — дефолт при незаданной переменной", (): void => {
    const result = LogConfig.tryParseEnv(baseEnv);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.LOG_LEVEL).toBe("info");
    }
  });

  it("принимает все уровни pino", (): void => {
    for (const level of PINO_LOG_LEVELS) {
      const result = LogConfig.tryParseEnv({ ...baseEnv, LOG_LEVEL: level });

      expect(result.success).toBe(true);
    }
  });

  it("каждый уровень enum принимает конструктор pino", (): void => {
    for (const level of PINO_LOG_LEVELS) {
      expect(() => pino({ level })).not.toThrow();
    }
  });

  it("отклоняет неизвестный уровень", (): void => {
    const result = LogConfig.tryParseEnv({ ...baseEnv, LOG_LEVEL: "verbose" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("LOG_LEVEL"))).toBe(true);
    }
  });
});
