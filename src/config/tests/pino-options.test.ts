import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();
process.env["LOG_LEVEL"] = "info";

import pino from "pino";
import { describe, expect, it } from "bun:test";
import { buildPinoHttpOptions } from "../pino-options";

const buildLogger = (lines: string[]) => {
  const options = buildPinoHttpOptions() as Record<string, unknown>;
  delete options["transport"];
  delete options["customLogLevel"];
  return pino(options as pino.LoggerOptions, {
    write: (line: string): void => {
      lines.push(line);
    },
  });
};

describe("buildPinoHttpOptions", (): void => {
  it("редактирует authorization и cookie в заголовках запроса", (): void => {
    const lines: string[] = [];
    buildLogger(lines).info(
      {
        req: {
          method: "GET",
          url: "/v1/panel/users",
          headers: {
            authorization: "Bearer super-secret-access-token",
            cookie: "session=super-secret-cookie",
          },
        },
      },
      "request completed",
    );

    const line = lines[0] ?? "";
    expect(line).not.toContain("super-secret-access-token");
    expect(line).not.toContain("super-secret-cookie");
    expect(line).toContain("[Redacted]");
  });

  it("редактирует токены и пароли в полях объектов", (): void => {
    const lines: string[] = [];
    buildLogger(lines).info(
      {
        password: "plain-password",
        accessToken: "yggdrasil-token",
        user: { refreshToken: "nested-refresh-token", clientToken: "nested-client-token" },
      },
      "auth payload",
    );

    const line = lines[0] ?? "";
    expect(line).not.toContain("plain-password");
    expect(line).not.toContain("yggdrasil-token");
    expect(line).not.toContain("nested-refresh-token");
    expect(line).not.toContain("nested-client-token");
  });

  it("warn проходит при уровне info — security-события видны в проде (TASK-67)", (): void => {
    const lines: string[] = [];
    buildLogger(lines).warn({ event: "login_failed" }, "Подозрительная активность");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Подозрительная активность");
  });

  it("редактирует old_password и new_password на верхнем и вложенном уровне (TASK-58)", (): void => {
    const lines: string[] = [];
    buildLogger(lines).info(
      {
        old_password: "old-plain-password",
        new_password: "new-plain-password",
        user: { new_password: "nested-new-password" },
      },
      "change password",
    );

    const line = lines[0] ?? "";
    expect(line).not.toContain("old-plain-password");
    expect(line).not.toContain("new-plain-password");
    expect(line).not.toContain("nested-new-password");
  });
});
