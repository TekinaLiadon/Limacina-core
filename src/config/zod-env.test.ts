import { describe, expect, it } from "bun:test";
import z from "zod";
import { ZodEnvConfig } from "./zod-env";

const schema = z.object({
  NODE_ENV: z.string(),
  JWT_ACCESS: z.string().min(1),
});

describe("ZodEnvConfig.tryParseEnv", () => {
  it("мержит SECRETS в переменные окружения", () => {
    const config = new ZodEnvConfig("test-secrets-merge", schema);

    const result = config.tryParseEnv({
      NODE_ENV: "test",
      JWT_ACCESS: "from-env",
      SECRETS: '{"JWT_ACCESS":"from-secrets"}',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.JWT_ACCESS).toBe("from-secrets");
    }
  });

  it("работает без SECRETS", () => {
    const config = new ZodEnvConfig("test-secrets-absent", schema);

    const result = config.tryParseEnv({ NODE_ENV: "test", JWT_ACCESS: "secret" });

    expect(result.success).toBe(true);
  });

  it("возвращает ошибку валидации вместо исключения при невалидном JSON в SECRETS", () => {
    const config = new ZodEnvConfig("test-secrets-invalid", schema);

    const result = config.tryParseEnv({
      NODE_ENV: "test",
      JWT_ACCESS: "secret",
      SECRETS: "not-json{{",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("SECRETS"))).toBe(true);
    }
  });
});
