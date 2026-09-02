import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { LauncherUpdateService } from "../launcher-update.service";

const VERSION_FILE = "public/version.json";
const VERSION_BACKUP = "public/version.json.bak";
const PLATFORM_DIR = "public/linux/x86_64";
const OLD_DIR = join(PLATFORM_DIR, "old");
const MACOS_PLATFORM_DIR = "public/macos/arm64";
const MACOS_PARENT_DIR = "public/macos";
const MACOS_ZIP_PATH = join(MACOS_PLATFORM_DIR, "Limacina-1.0.0-macos-arm64.zip");

function zipPath(version: string): string {
  return join(PLATFORM_DIR, `Limacina-${version}-linux-x86_64.zip`);
}

function oldZipPath(version: string): string {
  return join(OLD_DIR, `Limacina-${version}-linux-x86_64.zip`);
}

describe("LauncherUpdateService — архивирование старых версий", (): void => {
  let service: LauncherUpdateService;
  const createdFiles: string[] = [];
  const backedUpFiles: Array<{ path: string; backupPath: string }> = [];
  let oldDirCreatedByTest = false;

  beforeAll(() => {
    if (existsSync(VERSION_FILE)) {
      renameSync(VERSION_FILE, VERSION_BACKUP);
    }
    mkdirSync(PLATFORM_DIR, { recursive: true });
    if (existsSync(OLD_DIR)) {
      for (const file of readdirSync(OLD_DIR)) {
        const filePath = join(OLD_DIR, file);
        const backupPath = `${filePath}.bak`;
        renameSync(filePath, backupPath);
        backedUpFiles.push({ path: filePath, backupPath });
      }
    } else {
      mkdirSync(OLD_DIR, { recursive: true });
      oldDirCreatedByTest = true;
    }
    for (const file of readdirSync(PLATFORM_DIR)) {
      if (!file.endsWith(".zip")) continue;
      const filePath = join(PLATFORM_DIR, file);
      const backupPath = `${filePath}.bak`;
      renameSync(filePath, backupPath);
      backedUpFiles.push({ path: filePath, backupPath });
    }

    writeFileSync(zipPath("1.0.0"), "content-1.0.0");
    createdFiles.push(zipPath("1.0.0"));

    service = new LauncherUpdateService();
  });

  afterAll(() => {
    for (const filePath of createdFiles) {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
    for (const { path, backupPath } of backedUpFiles) {
      if (existsSync(backupPath)) {
        renameSync(backupPath, path);
      }
    }
    if (oldDirCreatedByTest) {
      rmSync(OLD_DIR, { recursive: true });
    }
    if (existsSync(VERSION_FILE)) {
      unlinkSync(VERSION_FILE);
    }
    if (existsSync(VERSION_BACKUP)) {
      renameSync(VERSION_BACKUP, VERSION_FILE);
    }
  });

  it("переносит старый zip в old/ при загрузке новой версии", () => {
    const result = service.update("1.1.0", [
      { os: "linux", arch: "x86_64", buffer: Buffer.from("content-1.1.0") },
    ]);
    createdFiles.push(zipPath("1.1.0"), oldZipPath("1.0.0"));

    expect(result).toEqual({ version: "1.1.0", updated: ["linux/x86_64"] });
    expect(readFileSync(zipPath("1.1.0"), "utf-8")).toBe("content-1.1.0");
    expect(readFileSync(oldZipPath("1.0.0"), "utf-8")).toBe("content-1.0.0");
    expect(JSON.parse(readFileSync(VERSION_FILE, "utf-8"))).toEqual({ version: "1.1.0" });
  });

  it("копит несколько версий в old/", () => {
    service.update("1.2.0", [
      { os: "linux", arch: "x86_64", buffer: Buffer.from("content-1.2.0") },
    ]);
    createdFiles.push(zipPath("1.2.0"), oldZipPath("1.1.0"));

    expect(readFileSync(zipPath("1.2.0"), "utf-8")).toBe("content-1.2.0");
    expect(existsSync(oldZipPath("1.0.0"))).toBe(true);
    expect(existsSync(oldZipPath("1.1.0"))).toBe(true);
    expect(readdirSync(PLATFORM_DIR).filter((f) => f.endsWith(".zip"))).toEqual([
      "Limacina-1.2.0-linux-x86_64.zip",
    ]);
  });

  it("перезаливает ту же версию на месте, не дублируя её в old/", () => {
    service.update("1.2.0", [
      { os: "linux", arch: "x86_64", buffer: Buffer.from("content-1.2.0-hotfix") },
    ]);

    expect(readFileSync(zipPath("1.2.0"), "utf-8")).toBe("content-1.2.0-hotfix");
    expect(existsSync(oldZipPath("1.2.0"))).toBe(false);
    expect(existsSync(oldZipPath("1.0.0"))).toBe(true);
    expect(existsSync(oldZipPath("1.1.0"))).toBe(true);
  });

  it("перезаписывает архивную копию при возврате к старой версии", () => {
    service.update("1.3.0", [
      { os: "linux", arch: "x86_64", buffer: Buffer.from("content-1.3.0") },
    ]);
    createdFiles.push(zipPath("1.3.0"), oldZipPath("1.2.0"));
    expect(existsSync(oldZipPath("1.2.0"))).toBe(true);

    service.update("1.2.0", [
      { os: "linux", arch: "x86_64", buffer: Buffer.from("content-1.2.0-again") },
    ]);
    createdFiles.push(oldZipPath("1.3.0"));

    expect(readFileSync(zipPath("1.2.0"), "utf-8")).toBe("content-1.2.0-again");
    expect(existsSync(zipPath("1.3.0"))).toBe(false);
    expect(existsSync(oldZipPath("1.3.0"))).toBe(true);
  });
});

describe("LauncherUpdateService — macos/arm64", (): void => {
  let service: LauncherUpdateService;
  let macosArm64Existed = false;
  let macosParentExisted = false;

  beforeAll(() => {
    macosArm64Existed = existsSync(MACOS_PLATFORM_DIR);
    macosParentExisted = existsSync(MACOS_PARENT_DIR);
    if (existsSync(VERSION_FILE)) {
      renameSync(VERSION_FILE, VERSION_BACKUP);
    }
    service = new LauncherUpdateService();
  });

  afterAll(() => {
    if (existsSync(MACOS_ZIP_PATH)) {
      unlinkSync(MACOS_ZIP_PATH);
    }
    if (!macosArm64Existed && existsSync(MACOS_PLATFORM_DIR)) {
      rmSync(MACOS_PLATFORM_DIR, { recursive: true });
    }
    if (!macosParentExisted && existsSync(MACOS_PARENT_DIR)) {
      rmSync(MACOS_PARENT_DIR, { recursive: true });
    }
    if (existsSync(VERSION_FILE)) {
      unlinkSync(VERSION_FILE);
    }
    if (existsSync(VERSION_BACKUP)) {
      renameSync(VERSION_BACKUP, VERSION_FILE);
    }
  });

  it("создаёт zip для macos/arm64", () => {
    const result = service.update("1.0.0", [
      { os: "macos", arch: "arm64", buffer: Buffer.from("macos-content") },
    ]);

    expect(result).toEqual({ version: "1.0.0", updated: ["macos/arm64"] });
    expect(readFileSync(MACOS_ZIP_PATH, "utf-8")).toBe("macos-content");
  });
});
