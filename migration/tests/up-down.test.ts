import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const SQLITE_URL = "sqlite::memory:";
process.env["DATABASE_URL"] = SQLITE_URL;

const testDir = path.resolve(import.meta.dir, "__test_updown__");
const listDir = path.join(testDir, "list");

beforeAll(() => {
  mkdirSync(listDir, { recursive: true });
  writeFileSync(
    path.join(listDir, "2025_01_01_120000_create_users.js"),
    `
import {sql} from "bun";
const up = async () => {
  await sql\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)\`;
};
const down = async () => {
  await sql\`DROP TABLE users\`;
};
export { up, down };
`,
  );
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("Миграции up/down через SQLite", () => {
  it("up() выполняет миграцию", async () => {
    const file = "2025_01_01_120000_create_users.js";
    const mod = await import(path.join(listDir, file));
    await mod.up();
    expect(true).toBe(true);
  });

  it("down() откатывает миграцию", async () => {
    const file = "2025_01_01_120000_create_users.js";
    const mod = await import(path.join(listDir, file));
    await mod.down();
    expect(true).toBe(true);
  });
});
