import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { migrateUp, migrateDown, installMigrations, ChecksumDriftError } from "bunsql-native-migrate";

const originalDatabaseUrl = process.env["DATABASE_URL"];

let dbPath: string;
let listDir: string;
let options: { databaseUrl: string; listDir: string };

beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), "limacina-migrate-"));
  dbPath = path.join(dir, "migrate.db");
  listDir = path.join(dir, "list");
  mkdirSync(listDir, { recursive: true });
  options = { databaseUrl: `sqlite:${dbPath}`, listDir };
  process.env["DATABASE_URL"] = options.databaseUrl;
});

afterAll(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env["DATABASE_URL"];
  } else {
    process.env["DATABASE_URL"] = originalDatabaseUrl;
  }
  rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

function writeMigration(file: string, upBody: string, downBody = ""): void {
  writeFileSync(
    path.join(listDir, file),
    `import { sql } from "bun";
const up = async () => {
  ${upBody}
};
const down = async () => {
  ${downBody}
};
export { up, down };
`,
  );
}

function readTables(): string[] {
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

function readRecorded(): string[] {
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

function readChecksums(): Record<string, string | null> {
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

describe("bunsql-native-migrate — smoke через SQLite", () => {
  it("installMigrations создаёт таблицу tracking и идемпотентен", async () => {
    await installMigrations(options);
    await installMigrations(options);
    expect(readTables()).toContain("migrations");
  });

  it("migrateUp применяет pending-миграции в порядке убывания имени и пишет checksum", async () => {
    writeMigration("2_second.js", "await sql`CREATE TABLE second_table (id INTEGER)`;");
    writeMigration("1_first.js", "await sql`CREATE TABLE first_table (id INTEGER)`;");

    const result = await migrateUp(options);

    expect(result.applied).toEqual(["2_second.js", "1_first.js"]);
    expect(readTables()).toContain("first_table");
    expect(readTables()).toContain("second_table");
    expect(readRecorded()).toEqual(["2_second.js", "1_first.js"]);
    expect(readChecksums()["1_first.js"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("повторный прогон не применяет ничего", async () => {
    const result = await migrateUp(options);
    expect(result.applied).toEqual([]);
  });

  it("новая миграция применяется при повторном прогоне", async () => {
    writeMigration("1_new.js", "await sql`CREATE TABLE new_table (id INTEGER)`;");
    const result = await migrateUp(options);
    expect(result.applied).toEqual(["1_new.js"]);
    expect(readTables()).toContain("new_table");
  });

  it("падение миграции останавливает прогон, применённые до неё сохраняются", async () => {
    writeMigration("1_boom.js", "throw new Error('boom');");
    try {
      await expect(migrateUp(options)).rejects.toThrow("boom");
      expect(readRecorded()).not.toContain("1_boom.js");

      writeMigration("0_after.js", "await sql`CREATE TABLE after_table (id INTEGER)`;");
      await expect(migrateUp(options)).rejects.toThrow("boom");
      expect(readRecorded()).not.toContain("0_after.js");
    } finally {
      rmSync(path.join(listDir, "1_boom.js"), { force: true });
      rmSync(path.join(listDir, "0_after.js"), { force: true });
    }
  });

  it("изменённая применённая миграция даёт ChecksumDriftError", async () => {
    writeMigration("1_drift.js", "await sql`CREATE TABLE drift_table (id INTEGER)`;");
    await migrateUp(options);

    writeFileSync(path.join(listDir, "1_drift.js"), "// tampered content\n");
    await expect(migrateUp(options)).rejects.toBeInstanceOf(ChecksumDriftError);

    writeMigration("1_drift.js", "await sql`CREATE TABLE drift_table (id INTEGER)`;");
    expect((await migrateUp(options)).applied).toEqual([]);
  });

  it("migrateDown откатывает последнюю применённую миграцию", async () => {
    writeMigration(
      "1_rollback.js",
      "await sql`CREATE TABLE rollback_table (id INTEGER)`;",
      "await sql`DROP TABLE rollback_table`;",
    );
    await migrateUp(options);

    const result = await migrateDown(options);

    expect(result.reverted).toEqual(["1_rollback.js"]);
    expect(readTables()).not.toContain("rollback_table");
    expect(readRecorded()).not.toContain("1_rollback.js");
  });

  it("migrateUp дозаполняет checksum у легаси-записи", async () => {
    writeMigration("1_legacy.js", "await sql`CREATE TABLE legacy_table (id INTEGER)`;");
    await migrateUp(options);
    expect(readChecksums()["1_legacy.js"]).toMatch(/^[0-9a-f]{64}$/);

    const legacy = new Database(dbPath);
    try {
      legacy.query("UPDATE migrations SET checksum = NULL WHERE migration = '1_legacy.js'").run();
    } finally {
      legacy.close();
    }

    const result = await migrateUp(options);
    expect(result.applied).toEqual([]);
    expect(readChecksums()["1_legacy.js"]).toMatch(/^[0-9a-f]{64}$/);
  });
});
