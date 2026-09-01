import { describe, expect, it } from "bun:test";
import AppConfig from "./global-config";

const baseEnv = {
  NODE_ENV: "development",
  JWT_ACCESS: "test-access-secret",
  JWT_REFRESH: "test-refresh-secret",
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

  it("принимает postgres в production", () => {
    const result = AppConfig.tryParseEnv({
      ...baseEnv,
      NODE_ENV: "production",
      DB_DRIVER: "postgres",
    });

    expect(result.success).toBe(true);
  });

  it("отклоняет sqlite", () => {
    const result = AppConfig.tryParseEnv({ ...baseEnv, DB_DRIVER: "sqlite" });

    expect(result.success).toBe(false);
  });
});
