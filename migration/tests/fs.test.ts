import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listFiles, resolveListDir } from "../core/fs.js";

const testDir = path.resolve(import.meta.dir, "__test_files__");

beforeAll(() => {
  mkdirSync(testDir, { recursive: true });
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("listFiles()", () => {
  it("находит .js файлы в директории", async () => {
    writeFileSync(path.join(testDir, "a.js"), "");
    writeFileSync(path.join(testDir, "b.js"), "");
    writeFileSync(path.join(testDir, "c.txt"), "");

    const files = await listFiles(testDir, "js");
    expect(files).toHaveLength(2);
    expect(files).toContain("a.js");
    expect(files).toContain("b.js");
    expect(files).not.toContain("c.txt");
  });

  it("возвращает пустой массив для пустой директории", async () => {
    const emptyDir = path.join(testDir, "empty");
    mkdirSync(emptyDir, { recursive: true });

    const files = await listFiles(emptyDir, "js");
    expect(files).toHaveLength(0);
  });
});

describe("resolveListDir()", () => {
  it("возвращает путь к migration/list/", () => {
    const listDir = resolveListDir();
    expect(listDir).toContain("migration");
    expect(listDir).toContain("list");
  });
});
