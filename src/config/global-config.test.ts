import { describe, expect, it } from "bun:test";
import AppConfig from "./global-config";

const baseEnv = {
  NODE_ENV: "development",
  JWT_ACCESS: "test-access-secret-test-access-secret-32",
  JWT_REFRESH: "test-refresh-secret-test-refresh-secret-32",
  BASE_URL: "http://localhost:3005",
};

describe("AppConfig", () => {
  it("принимает map вне production", () => {
    const result = AppConfig.tryParseEnv({ ...baseEnv, DB_DRIVER: "map" });

    expect(result.success).toBe(true);
  });

  it("map — дефолт вне production", () => {
    const result = AppConfig.tryParseEnv({ ...baseEnv });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DB_DRIVER).toBe("map");
    }
  });

  it("отклоняет map в production", () => {
    const result = AppConfig.tryParseEnv({
      ...baseEnv,
      NODE_ENV: "production",
      DB_DRIVER: "map",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("DB_DRIVER"))).toBe(true);
    }
  });

  it("принимает postgres в production при наличии DATABASE_URL", () => {
    const result = AppConfig.tryParseEnv({
      ...baseEnv,
      NODE_ENV: "production",
      DB_DRIVER: "postgres",
      DATABASE_URL: "postgres://localhost:5432/limacina",
    });

    expect(result.success).toBe(true);
  });

  it("отклоняет postgres без DATABASE_URL", () => {
    const result = AppConfig.tryParseEnv({
      ...baseEnv,
      NODE_ENV: "production",
      DB_DRIVER: "postgres",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("DATABASE_URL"))).toBe(true);
    }
  });

  it("map не требует DATABASE_URL", () => {
    const result = AppConfig.tryParseEnv({ ...baseEnv, DB_DRIVER: "map" });

    expect(result.success).toBe(true);
  });

  it("отклоняет sqlite", () => {
    const result = AppConfig.tryParseEnv({ ...baseEnv, DB_DRIVER: "sqlite" });

    expect(result.success).toBe(false);
  });

  it("отклоняет неизвестный NODE_ENV", () => {
    const result = AppConfig.tryParseEnv({ ...baseEnv, NODE_ENV: "prod" });

    expect(result.success).toBe(false);
  });

  it("принимает test и production", () => {
    const testResult = AppConfig.tryParseEnv({ ...baseEnv, NODE_ENV: "test" });
    const productionResult = AppConfig.tryParseEnv({
      ...baseEnv,
      NODE_ENV: "production",
      DB_DRIVER: "postgres",
      DATABASE_URL: "postgres://localhost:5432/limacina",
    });

    expect(testResult.success).toBe(true);
    expect(productionResult.success).toBe(true);
  });

  it("отклоняет короткие JWT-секреты", () => {
    const result = AppConfig.tryParseEnv({
      ...baseEnv,
      JWT_ACCESS: "short",
      JWT_REFRESH: "short",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("JWT_ACCESS"))).toBe(true);
      expect(result.error.issues.some((issue) => issue.path.includes("JWT_REFRESH"))).toBe(true);
    }
  });

  it("BASE_URL обязателен", () => {
    const { BASE_URL: _, ...envWithoutBaseUrl } = baseEnv;

    const result = AppConfig.tryParseEnv(envWithoutBaseUrl);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("BASE_URL"))).toBe(true);
    }
  });

  it("принимает полный 40-символьный SHA в DEPLOY_PINNED_REVISION", () => {
    const result = AppConfig.tryParseEnv({
      ...baseEnv,
      DEPLOY_PINNED_REVISION: "a".repeat(40),
    });

    expect(result.success).toBe(true);
  });

  it("отклоняет неполный SHA в DEPLOY_PINNED_REVISION", () => {
    const result = AppConfig.tryParseEnv({
      ...baseEnv,
      DEPLOY_PINNED_REVISION: "abc123",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.includes("DEPLOY_PINNED_REVISION")),
      ).toBe(true);
    }
  });

  it("SECRETS добавляет значения, отсутствующие в env", () => {
    const result = AppConfig.tryParseEnv({
      ...baseEnv,
      SECRETS: JSON.stringify({ MASTER_PASSWORD: "secret-pass" }),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MASTER_PASSWORD).toBe("secret-pass");
    }
  });

  it("env перекрывает SECRETS при конфликте", () => {
    const result = AppConfig.tryParseEnv({
      ...baseEnv,
      BASE_URL: "http://env-wins.test",
      SECRETS: JSON.stringify({ BASE_URL: "http://secrets-win.test" }),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.BASE_URL).toBe("http://env-wins.test");
    }
  });

  it("отклоняет SECRETS, не являющийся JSON-объектом", () => {
    for (const raw of ["[1,2]", '"str"', "42", "null", "{broken"]) {
      const result = AppConfig.tryParseEnv({ ...baseEnv, SECRETS: raw });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes("SECRETS"))).toBe(true);
      }
    }
  });

  it("CORS_ORIGINS тримит записи и режет до 100", () => {
    const result = AppConfig.tryParseEnv({
      ...baseEnv,
      CORS_ORIGINS: ` http://a.test , http://b.test ,,${Array.from(
        { length: 120 },
        (_, i) => `http://host${i}.test`,
      ).join(",")}`,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.CORS_ORIGINS).toEqual([
        "http://a.test",
        "http://b.test",
        ...Array.from({ length: 98 }, (_, i) => `http://host${i}.test`),
      ]);
    }
  });

  it("пустая CORS_ORIGINS даёт undefined (дефолт)", () => {
    const result = AppConfig.tryParseEnv({ ...baseEnv, CORS_ORIGINS: "" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.CORS_ORIGINS).toBeUndefined();
    }
  });
});
