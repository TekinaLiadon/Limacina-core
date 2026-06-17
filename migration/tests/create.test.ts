import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import { createMigration } from "../cli/create.js";

const testDir = path.resolve(import.meta.dir, "__test_cli__");
const listDir = path.join(testDir, "list");

beforeAll(() => {
  mkdirSync(listDir, { recursive: true });
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("createMigration()", () => {
  it("создаёт миграцию с указанным именем", async () => {
    const filename = await createMigration({
      name: "my_migration",
      listDir,
    });
    expect(filename).toContain("my_migration.js");

    const files = readdirSync(listDir).filter((f) => f.endsWith(".js"));
    expect(files.length).toBe(1);
    expect(files[0]).toBe(filename);
  });

  it("создаёт миграцию с рандомным именем если имя не указано", async () => {
    const filename = await createMigration({ listDir });
    expect(filename).toMatch(/\.js$/);

    const files = readdirSync(listDir).filter((f) => f.endsWith(".js"));
    expect(files.length).toBe(2);
  });

  it("имя файла содержит timestamp YYYY_MM_DD_HHMMSS", async () => {
    const filename = await createMigration({ name: "timestamp_test", listDir });
    expect(filename).toMatch(/^\d{13}_\d{4}_\d{2}_\d{2}_timestamp_test\.js$/);
  });

  it("созданный файл не пустой (содержит шаблон stub.js)", async () => {
    const filename = await createMigration({ name: "stub_check", listDir });
    const content = await Bun.file(path.join(listDir, filename)).text();
    expect(content).toContain("up");
    expect(content).toContain("down");
  });
});
