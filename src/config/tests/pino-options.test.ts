import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();
process.env["LOG_LEVEL"] = "info";

import pino from "pino";
import { describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import type { Writable } from "node:stream";
import { join } from "node:path";
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

  it("warn проходит при уровне info — security-события видны в проде", (): void => {
    const lines: string[] = [];
    buildLogger(lines).warn({ event: "login_failed" }, "Подозрительная активность");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Подозрительная активность");
  });

  it("прод: строка лога уходит и в файл, и в stdout", async (): Promise<void> => {
    mkdirSync(join(process.cwd(), "logs"), { recursive: true });
    const originalStdoutWrite = process.stdout.write;
    const stdoutChunks: string[] = [];
    process.stdout.write = ((chunk: unknown): boolean => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const options = buildPinoHttpOptions({
        NODE_ENV: "production",
        LOG_LEVEL: "info",
      }) as Record<string, unknown>;
      const stream = options["stream"] as Writable;
      await new Promise<void>((resolve, reject) => {
        stream.write("prod-stdout-line\n", "utf8", (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } finally {
      process.stdout.write = originalStdoutWrite;
    }

    expect(stdoutChunks.join("")).toContain("prod-stdout-line");
    const logDate = new Date().toISOString().slice(0, 10);
    const fileLine = await Bun.file(join(process.cwd(), "logs", `${logDate}.log`)).text();
    expect(fileLine).toContain("prod-stdout-line");
  });

  it("редактирует old_password и new_password на верхнем и вложенном уровне", (): void => {
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
