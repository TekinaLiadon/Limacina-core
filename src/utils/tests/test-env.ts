export function setupTestEnv(): void {
  process.env["NODE_ENV"] = "test";
  process.env["JWT_ACCESS"] = "test-access-secret-0123456789abcdef0123";
  process.env["JWT_REFRESH"] = "test-refresh-secret-0123456789abcdef0123";
  process.env["BASE_URL"] = "http://localhost:3005";
  process.env["DB_DRIVER"] = "map";
  delete process.env["REDIS_URL"];
}
