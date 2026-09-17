export function setupTestEnv(): void {
  process.env["NODE_ENV"] = "test";
  process.env["JWT_ACCESS"] = "test-access-secret-0123456789abcdef0123";
  process.env["JWT_REFRESH"] = "test-refresh-secret-0123456789abcdef0123";
  process.env["BASE_URL"] = "http://localhost:3005";
  process.env["DB_DRIVER"] = "map";
  process.env["RATE_LIMIT_AUTH_IP_MAX"] = "1000";
  delete process.env["REDIS_URL"];
}

export function baseRequiredEnv(): Record<string, string> {
  return {
    NODE_ENV: "test",
    JWT_ACCESS: "test-access-secret-0123456789abcdef0123",
    JWT_REFRESH: "test-refresh-secret-0123456789abcdef0123",
    BASE_URL: "http://localhost:3005",
    DB_DRIVER: "map",
  };
}
