import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { removeFilesQuietly, writeFileAtomicSync } from "../fs";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "limacina-fs-test-"));
}

describe("writeFileAtomicSync", (): void => {
  it("записывает файл через tmp и не оставляет tmp после успеха", (): void => {
    const dir = makeTempDir();
    try {
      const target = join(dir, "file.txt");

      writeFileAtomicSync(target, "content");

      expect(readFileSync(target, "utf-8")).toBe("content");
      expect(existsSync(`${target}.tmp`)).toBeFalse();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("перезаписывает существующий файл атомарно", (): void => {
    const dir = makeTempDir();
    try {
      const target = join(dir, "file.txt");
      writeFileSync(target, "old");

      writeFileAtomicSync(target, "new");

      expect(readFileSync(target, "utf-8")).toBe("new");
      expect(existsSync(`${target}.tmp`)).toBeFalse();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("при сбое записи подчищает tmp и пробрасывает ошибку", (): void => {
    const dir = makeTempDir();
    try {
      const target = join(dir, "missing", "file.txt");

      expect(() => writeFileAtomicSync(target, "content")).toThrow();
      expect(existsSync(`${target}.tmp`)).toBeFalse();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("removeFilesQuietly", (): void => {
  it("удаляет существующие файлы и молча пропускает отсутствующие", (): void => {
    const dir = makeTempDir();
    try {
      const removed = join(dir, "removed.txt");
      writeFileSync(removed, "removed");
      const untouched = join(dir, "untouched.txt");
      writeFileSync(untouched, "untouched");

      removeFilesQuietly(new Logger("Test"), [removed, join(dir, "missing.txt")], "сбой");

      expect(existsSync(removed)).toBeFalse();
      expect(existsSync(untouched)).toBeTrue();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ошибка удаления логируется, но не бросает", (): void => {
    const dir = makeTempDir();
    try {
      const subdir = join(dir, "subdir");
      mkdirSync(subdir);
      const errors: unknown[][] = [];
      const fakeLogger = {
        error: (...args: unknown[]) => {
          errors.push(args);
        },
      };

      expect(() =>
        removeFilesQuietly(fakeLogger as unknown as Logger, [subdir], "сбой удаления"),
      ).not.toThrow();
      expect(existsSync(subdir)).toBeTrue();
      expect(errors).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
