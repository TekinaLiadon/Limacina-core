import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");

function loadDatabaseUrl(): string | undefined {
  if (process.env["DATABASE_URL"]) return process.env["DATABASE_URL"];
  const envFile = join(PROJECT_ROOT, ".env");
  if (!existsSync(envFile)) return undefined;
  for (const line of readFileSync(envFile, "utf-8").split("\n")) {
    const [name, value] = line.split("=", 2);
    if (name === "DATABASE_URL") return value?.trim();
  }
  return undefined;
}

const DATABASE_URL = loadDatabaseUrl();

describe("bunsql-native-migrate — smoke против дев-БД", () => {
  const itWithDatabase = it.skipIf(DATABASE_URL === undefined);

  itWithDatabase(
    "bun run migrate:up проходит без ошибок и без checksum drift",
    async () => {
      const proc = Bun.spawn(["bun", "run", "migrate:up"], {
        cwd: PROJECT_ROOT,
        env: { ...process.env, DATABASE_URL: DATABASE_URL as string },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const output = `${stdout}\n${stderr}`;

      expect(exitCode).toBe(0);
      expect(output).not.toContain("was modified after it was applied");
      expect(output).not.toContain("migration failed");
    },
    60_000,
  );
});
