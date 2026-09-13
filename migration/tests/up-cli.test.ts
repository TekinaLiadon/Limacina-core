import { describe, it, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";

const CLI_DIR = path.resolve(import.meta.dir, "..", "cli");

interface MigrationScenario {
  dbPath: string;
  listDir: string;
  env: Record<string, string>;
}

function makeScenario(): MigrationScenario {
  const dir = mkdtempSync(path.join(tmpdir(), "limacina-upcli-"));
  const dbPath = path.join(dir, "migrate.db");
  const listDir = path.join(dir, "list");
  mkdirSync(listDir, { recursive: true });
  const env = {
    ...process.env,
    DATABASE_URL: `sqlite:${dbPath}`,
    MIGRATION_LIST_DIR: listDir,
  };
  return { dbPath, listDir, env };
}

function writeMigration(listDir: string, file: string, upBody: string): void {
  writeFileSync(
    path.join(listDir, file),
    `import { sql } from "bun";
const up = async () => {
  ${upBody}
};
const down = async () => {};
export { up, down };
`,
  );
}

async function runCli(
  script: string,
  env: Record<string, string>,
): Promise<{ exitCode: number; output: string }> {
  const proc = Bun.spawn(["bun", path.join(CLI_DIR, script)], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, output: `${stdout}\n${stderr}` };
}

function readTables(dbPath: string): string[] {
  const db = new Database(dbPath);
  try {
    return db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
  } finally {
    db.close();
  }
}

function readRecorded(dbPath: string): string[] {
  const db = new Database(dbPath);
  try {
    return db
      .query<{ migration: string }, []>("SELECT migration FROM migrations ORDER BY id ASC")
      .all()
      .map((row) => row.migration);
  } finally {
    db.close();
  }
}

function readChecksums(dbPath: string): Record<string, string | null> {
  const db = new Database(dbPath);
  try {
    const rows = db
      .query<{ migration: string; checksum: string | null }, []>(
        "SELECT migration, checksum FROM migrations ORDER BY id ASC",
      )
      .all();
    return Object.fromEntries(rows.map((row) => [row.migration, row.checksum]));
  } finally {
    db.close();
  }
}

describe("migration/cli/up.ts", () => {
  it("останавливается на первой упавшей миграции и выходит с кодом 1", async () => {
    const { dbPath, listDir, env } = makeScenario();
    try {
      writeMigration(listDir, "3_first.js", "await sql`CREATE TABLE first_table (id INTEGER)`;");
      writeMigration(
        listDir,
        "2_failing.js",
        "await sql`CREATE TABLE partial_table (id INTEGER)`;\n  throw new Error('boom');",
      );
      writeMigration(listDir, "1_third.js", "await sql`CREATE TABLE third_table (id INTEGER)`;");

      expect((await runCli("install.ts", env)).exitCode).toBe(0);

      const up = await runCli("up.ts", env);
      expect(up.exitCode).toBe(1);
      expect(up.output).toContain("2_failing.js migration failed");

      const tables = readTables(dbPath);
      expect(tables).toContain("first_table");
      expect(tables).toContain("partial_table");
      expect(tables).not.toContain("third_table");
      expect(readRecorded(dbPath)).toEqual(["3_first.js"]);
    } finally {
      rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });

  it("применяет все миграции и выходит с кодом 0", async () => {
    const { dbPath, listDir, env } = makeScenario();
    try {
      writeMigration(listDir, "2_second.js", "await sql`CREATE TABLE second_table (id INTEGER)`;");
      writeMigration(listDir, "1_first.js", "await sql`CREATE TABLE first_table (id INTEGER)`;");

      expect((await runCli("install.ts", env)).exitCode).toBe(0);
      expect((await runCli("up.ts", env)).exitCode).toBe(0);

      const tables = readTables(dbPath);
      expect(tables).toContain("first_table");
      expect(tables).toContain("second_table");
      expect(readRecorded(dbPath)).toEqual(["2_second.js", "1_first.js"]);
    } finally {
      rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });

  it("без pending-миграций выходит с кодом 0", async () => {
    const { dbPath, env } = makeScenario();
    try {
      expect((await runCli("install.ts", env)).exitCode).toBe(0);

      const up = await runCli("up.ts", env);
      expect(up.exitCode).toBe(0);
      expect(up.output).toContain("No pending migrations.");
      expect(readRecorded(dbPath)).toEqual([]);
    } finally {
      rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });

  it("повторный прогон применяет только новые миграции", async () => {
    const { dbPath, listDir, env } = makeScenario();
    try {
      writeMigration(listDir, "2_first.js", "await sql`CREATE TABLE first_table (id INTEGER)`;");
      expect((await runCli("install.ts", env)).exitCode).toBe(0);
      expect((await runCli("up.ts", env)).exitCode).toBe(0);

      writeMigration(listDir, "1_new.js", "await sql`CREATE TABLE new_table (id INTEGER)`;");
      expect((await runCli("up.ts", env)).exitCode).toBe(0);

      expect(readRecorded(dbPath)).toEqual(["2_first.js", "1_new.js"]);
    } finally {
      rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });

  it("записывает checksum применённой миграции и up.ts сам создаёт таблицу", async () => {
    const { dbPath, listDir, env } = makeScenario();
    try {
      writeMigration(listDir, "1_only.js", "await sql`CREATE TABLE only_table (id INTEGER)`;");

      expect((await runCli("up.ts", env)).exitCode).toBe(0);
      expect(readTables(dbPath)).toContain("only_table");

      const checksums = readChecksums(dbPath);
      expect(checksums["1_only.js"]).toBeTruthy();
      expect(checksums["1_only.js"]).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });

  it("падает, если применённая миграция была изменена после применения", async () => {
    const { dbPath, listDir, env } = makeScenario();
    try {
      writeMigration(listDir, "1_first.js", "await sql`CREATE TABLE first_table (id INTEGER)`;");
      expect((await runCli("up.ts", env)).exitCode).toBe(0);

      writeFileSync(path.join(listDir, "1_first.js"), "// tampered content\n");
      const up = await runCli("up.ts", env);

      expect(up.exitCode).toBe(1);
      expect(up.output).toContain("1_first.js was modified after it was applied");
      expect(readRecorded(dbPath)).toEqual(["1_first.js"]);
    } finally {
      rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });

  it("повторный прогон не падает при неизменённых файлах", async () => {
    const { dbPath, listDir, env } = makeScenario();
    try {
      writeMigration(listDir, "1_first.js", "await sql`CREATE TABLE first_table (id INTEGER)`;");
      expect((await runCli("up.ts", env)).exitCode).toBe(0);
      expect((await runCli("up.ts", env)).exitCode).toBe(0);
      expect((await runCli("up.ts", env)).output).toContain("No pending migrations.");
    } finally {
      rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });

  it("дозаполняет checksum у легаси-записей без checksum", async () => {
    const { dbPath, listDir, env } = makeScenario();
    try {
      writeMigration(listDir, "1_first.js", "await sql`CREATE TABLE first_table (id INTEGER)`;");
      expect((await runCli("up.ts", env)).exitCode).toBe(0);

      const legacy = new Database(dbPath);
      try {
        legacy.query("UPDATE migrations SET checksum = NULL").run();
      } finally {
        legacy.close();
      }

      expect((await runCli("up.ts", env)).exitCode).toBe(0);
      expect(readChecksums(dbPath)["1_first.js"]).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });
});
