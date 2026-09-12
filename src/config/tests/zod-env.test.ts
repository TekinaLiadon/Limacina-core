process.env["JWT_ACCESS"] = "test-access-secret-0123456789abcdef0123";
process.env["JWT_REFRESH"] = "test-refresh-secret-0123456789abcdef0123";
process.env["NODE_ENV"] = "test";
process.env["BASE_URL"] = "http://localhost:3005";
process.env["DB_DRIVER"] = "map";

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { ZodEnvConfig } from "../zod-env";

const schema = z.object({
  NODE_ENV: z.literal("test"),
  JWT_ACCESS: z.string().min(1),
  MASTER_PASSWORD: z.string().optional(),
});

function buildConfig(): ZodEnvConfig<typeof schema> {
  return new ZodEnvConfig("test-env", schema);
}

function expectFailure(config: ZodEnvConfig<typeof schema>, env: Record<string, string>) {
  const result = config.tryParseEnv(env);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("ожидалась ошибка валидации");
  return result.error;
}

describe("ZodEnvConfig — мердж SECRETS", (): void => {
  it("мержит SECRETS в переменные окружения", (): void => {
    const result = buildConfig().tryParseEnv({
      NODE_ENV: "test",
      JWT_ACCESS: "from-env",
      SECRETS: '{"JWT_ACCESS":"from-secrets","MASTER_PASSWORD":"from-secrets"}',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.JWT_ACCESS).toBe("from-secrets");
      expect(result.data.MASTER_PASSWORD).toBe("from-secrets");
    }
  });

  it("работает без SECRETS", (): void => {
    const result = buildConfig().tryParseEnv({ NODE_ENV: "test", JWT_ACCESS: "secret" });

    expect(result.success).toBe(true);
  });

  it("возвращает ошибку валидации вместо исключения при невалидном JSON в SECRETS", (): void => {
    const error = expectFailure(buildConfig(), {
      NODE_ENV: "test",
      JWT_ACCESS: "secret",
      SECRETS: "not-json{{",
    });

    expect(error.issues.some((issue) => issue.path.includes("SECRETS"))).toBe(true);
  });

  it("отклоняет валидный JSON, не являющийся объектом", (): void => {
    for (const raw of ["null", "42", '"text"', "[1,2]"]) {
      const error = expectFailure(buildConfig(), {
        NODE_ENV: "test",
        JWT_ACCESS: "secret",
        SECRETS: raw,
      });

      expect(error.issues.some((issue) => issue.path.includes("SECRETS"))).toBe(true);
    }
  });

  it("принимает пустой объект в SECRETS", (): void => {
    const result = buildConfig().tryParseEnv({
      NODE_ENV: "test",
      JWT_ACCESS: "secret",
      SECRETS: "{}",
    });

    expect(result.success).toBe(true);
  });
});

describe("ZodEnvConfig — санитизация ошибок", (): void => {
  it("issues ошибки не содержат сырых значений env", (): void => {
    const error = expectFailure(buildConfig(), {
      NODE_ENV: "production",
      JWT_ACCESS: "super-jwt-access-secret",
    });

    const serialized = JSON.stringify(error.issues);
    expect(serialized).not.toContain("super-jwt-access-secret");
    expect(serialized).not.toContain("production");
  });

  it("ошибка SECRETS не содержит сырого JSON", (): void => {
    const error = expectFailure(buildConfig(), {
      NODE_ENV: "test",
      JWT_ACCESS: "secret",
      SECRETS: '{"MASTER_PASSWORD":"super-master-password"}-broken',
    });

    const serialized = JSON.stringify(error.issues);
    expect(serialized).not.toContain("super-master-password");
  });

  it("flattenError лога не содержит секретов и упоминает поле", (): void => {
    const error = expectFailure(buildConfig(), { NODE_ENV: "test", SECRETS: "{not-json" });

    const flattened = z.flattenError(error).fieldErrors;
    const serialized = JSON.stringify(flattened);
    expect(serialized).not.toContain("super-jwt-access-secret");
    expect(serialized).not.toContain("super-master-password");
    expect(serialized).toContain("SECRETS");
  });

  it("несовпадение типа поля из SECRETS даёт ошибку без сырого значения", (): void => {
    const error = expectFailure(buildConfig(), {
      NODE_ENV: "test",
      JWT_ACCESS: "secret",
      SECRETS: JSON.stringify({ MASTER_PASSWORD: 12345 }),
    });

    const serialized = JSON.stringify(error.issues);
    expect(serialized).not.toContain("12345");
    expect(JSON.stringify(z.flattenError(error).fieldErrors)).toContain("MASTER_PASSWORD");
  });
});
