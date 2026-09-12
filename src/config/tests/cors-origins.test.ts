import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it } from "bun:test";
import { Writable } from "node:stream";
import GlobalConfig, { type AppConfigType } from "../global-config";
import { buildPinoHttpOptions } from "../pino-options";

function parseWith(overrides: Record<string, string | undefined>): AppConfigType {
  const env: Record<string, string | undefined> = {
    JWT_ACCESS: "test-access-secret-0123456789abcdef0123",
    JWT_REFRESH: "test-refresh-secret-0123456789abcdef0123",
    NODE_ENV: "test",
    BASE_URL: "http://localhost:3005",
    DB_DRIVER: "map",
    ...overrides,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  return GlobalConfig.parseEnvOrExit(env);
}

describe("CORS_ORIGINS в AppConfig", (): void => {
  it("отсутствует — undefined (CORS любой источник, как раньше)", (): void => {
    expect(parseWith({ CORS_ORIGINS: undefined }).CORS_ORIGINS).toBeUndefined();
  });

  it("пустая строка и пробелы — undefined", (): void => {
    expect(parseWith({ CORS_ORIGINS: "" }).CORS_ORIGINS).toBeUndefined();
    expect(parseWith({ CORS_ORIGINS: "   " }).CORS_ORIGINS).toBeUndefined();
  });

  it("один источник без пробелов", (): void => {
    expect(parseWith({ CORS_ORIGINS: "https://panel.example.com" }).CORS_ORIGINS).toEqual([
      "https://panel.example.com",
    ]);
  });

  it("список с пробелами тримится", (): void => {
    expect(
      parseWith({ CORS_ORIGINS: "https://a.com , https://b.com ,https://c.com" }).CORS_ORIGINS,
    ).toEqual(["https://a.com", "https://b.com", "https://c.com"]);
  });

  it("источник из SECRETS доходит до конфига", (): void => {
    const env = {
      JWT_ACCESS: "test-access-secret-0123456789abcdef0123",
      JWT_REFRESH: "test-refresh-secret-0123456789abcdef0123",
      NODE_ENV: "test",
      BASE_URL: "http://localhost:3005",
      DB_DRIVER: "map",
      SECRETS: JSON.stringify({ CORS_ORIGINS: "https://from-secrets.com" }),
    };
    expect(GlobalConfig.parseEnvOrExit(env).CORS_ORIGINS).toEqual(["https://from-secrets.com"]);
  });

  it("не-строка из SECRETS не проходит", (): void => {
    const env = {
      JWT_ACCESS: "test-access-secret-0123456789abcdef0123",
      JWT_REFRESH: "test-refresh-secret-0123456789abcdef0123",
      NODE_ENV: "test",
      BASE_URL: "http://localhost:3005",
      DB_DRIVER: "map",
      SECRETS: JSON.stringify({ CORS_ORIGINS: 123 }),
    };
    const result = GlobalConfig.tryParseEnv(env);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).not.toContain("123");
    expect(JSON.stringify(result.error.issues)).toContain("CORS_ORIGINS");
  });
});

describe("NODE_ENV в опциях pino", (): void => {
  it("не-production включает pretty-transport", (): void => {
    const options = buildPinoHttpOptions({ NODE_ENV: "development", LOG_LEVEL: "info" });
    expect(options.transport).toBeDefined();
  });

  it("production включает файловый стрим вместо pretty-transport", (): void => {
    const options = buildPinoHttpOptions({ NODE_ENV: "production", LOG_LEVEL: "info" });
    expect(options.transport).toBeUndefined();
    expect(options.stream).toBeInstanceOf(Writable);
  });
});
