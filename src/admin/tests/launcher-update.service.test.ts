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
import { OLD_VERSIONS_DIR } from "../../launcher/launcher-files";

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

  const resetToBaseline = (): void => {
    service.update("1.0.0", [
      { os: "linux", arch: "x86_64", buffer: Buffer.from("content-1.0.0") },
    ]);
    for (const dir of [PLATFORM_DIR, OLD_DIR]) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".zip")) continue;
        if (file === "Limacina-1.0.0-linux-x86_64.zip") continue;
        const filePath = join(dir, file);
        unlinkSync(filePath);
        createdFiles.push(filePath);
      }
    }
  };

  it("переносит старый zip в old/ при загрузке новой версии", () => {
    const result = service.update("1.1.0", [
      { os: "linux", arch: "x86_64", buffer: Buffer.from("content-1.1.0") },
    ]);
    createdFiles.push(zipPath("1.1.0"));

    expect(result).toEqual({ version: "1.1.0", updated: ["linux/x86_64"] });
    expect(readFileSync(zipPath("1.1.0"), "utf-8")).toBe("content-1.1.0");
    expect(readFileSync(oldZipPath("1.0.0"), "utf-8")).toBe("content-1.0.0");
    expect(JSON.parse(readFileSync(VERSION_FILE, "utf-8"))).toEqual({ version: "1.1.0" });

    resetToBaseline();
  });

  it("копит несколько версий в old/", () => {
    service.update("1.1.0", [
      { os: "linux", arch: "x86_64", buffer: Buffer.from("content-1.1.0") },
    ]);
    createdFiles.push(zipPath("1.1.0"));
    service.update("1.2.0", [
      { os: "linux", arch: "x86_64", buffer: Buffer.from("content-1.2.0") },
    ]);
    createdFiles.push(zipPath("1.2.0"));

    expect(readFileSync(zipPath("1.2.0"), "utf-8")).toBe("content-1.2.0");
    expect(existsSync(oldZipPath("1.0.0"))).toBe(true);
    expect(existsSync(oldZipPath("1.1.0"))).toBe(true);
    expect(readdirSync(PLATFORM_DIR).filter((f) => f.endsWith(".zip"))).toEqual([
      "Limacina-1.2.0-linux-x86_64.zip",
    ]);

    resetToBaseline();
  });

  it("перезаливает ту же версию на месте, не дублируя её в old/", () => {
    service.update("1.2.0", [
      { os: "linux", arch: "x86_64", buffer: Buffer.from("content-1.2.0") },
    ]);
    createdFiles.push(zipPath("1.2.0"));
    service.update("1.2.0", [
      { os: "linux", arch: "x86_64", buffer: Buffer.from("content-1.2.0-hotfix") },
    ]);

    expect(readFileSync(zipPath("1.2.0"), "utf-8")).toBe("content-1.2.0-hotfix");
    expect(existsSync(oldZipPath("1.2.0"))).toBe(false);
    expect(existsSync(oldZipPath("1.0.0"))).toBe(true);

    resetToBaseline();
  });

  it("перезаписывает архивную копию при возврате к старой версии", () => {
    service.update("1.2.0", [
      { os: "linux", arch: "x86_64", buffer: Buffer.from("content-1.2.0") },
    ]);
    createdFiles.push(zipPath("1.2.0"));
    service.update("1.3.0", [
      { os: "linux", arch: "x86_64", buffer: Buffer.from("content-1.3.0") },
    ]);
    createdFiles.push(zipPath("1.3.0"));
    expect(existsSync(oldZipPath("1.2.0"))).toBe(true);

    service.update("1.2.0", [
      { os: "linux", arch: "x86_64", buffer: Buffer.from("content-1.2.0-again") },
    ]);

    expect(readFileSync(zipPath("1.2.0"), "utf-8")).toBe("content-1.2.0-again");
    expect(existsSync(zipPath("1.3.0"))).toBe(false);
    expect(existsSync(oldZipPath("1.3.0"))).toBe(true);

    resetToBaseline();
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

describe("LauncherUpdateService — порядок мутаций и атомарность", (): void => {
  let service: LauncherUpdateService;
  const sandboxDir = join("public", "windows", "x86_64");
  const sandboxOldDir = join(sandboxDir, OLD_VERSIONS_DIR);
  const backedUpFiles: Array<{ path: string; backupPath: string }> = [];

  const sandboxZipPath = (version: string): string =>
    join(sandboxDir, `Limacina-${version}-windows-x86_64.zip`);
  const sandboxOldZipPath = (version: string): string =>
    join(sandboxOldDir, `Limacina-${version}-windows-x86_64.zip`);
  const readVersionFile = (): string =>
    (JSON.parse(readFileSync(VERSION_FILE, "utf-8")) as { version: string }).version;
  const zipsInDir = (dir: string): string[] =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith(".zip"))
          .sort()
      : [];

  const backupExistingFiles = (): void => {
    for (const dir of [sandboxDir, sandboxOldDir]) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".zip")) continue;
        const filePath = join(dir, file);
        const backupPath = `${filePath}.bak`;
        renameSync(filePath, backupPath);
        backedUpFiles.push({ path: filePath, backupPath });
      }
    }
  };

  const seedBaseline = (): void => {
    removeTestZips();
    mkdirSync(sandboxDir, { recursive: true });
    writeFileSync(VERSION_FILE, JSON.stringify({ version: "1.0.0" }));
    writeFileSync(sandboxZipPath("1.0.0"), "content-1.0.0");
  };

  const removeTestZips = (): void => {
    for (const dir of [sandboxDir, sandboxOldDir]) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".zip")) continue;
        unlinkSync(join(dir, file));
      }
    }
  };

  beforeAll(() => {
    if (existsSync(VERSION_FILE)) {
      renameSync(VERSION_FILE, VERSION_BACKUP);
    }
    backupExistingFiles();
    service = new LauncherUpdateService();
  });

  afterAll(() => {
    removeTestZips();
    for (const { path, backupPath } of backedUpFiles) {
      if (existsSync(backupPath)) {
        renameSync(backupPath, path);
      }
    }
    if (existsSync(VERSION_FILE)) {
      unlinkSync(VERSION_FILE);
    }
    if (existsSync(VERSION_BACKUP)) {
      renameSync(VERSION_BACKUP, VERSION_FILE);
    }
  });

  it("отклоняет невалидную платформу до любых мутаций: version.json и zip не тронуты", () => {
    seedBaseline();

    expect(() =>
      service.update("2.0.0", [
        { os: "windows", arch: "x86_64", buffer: Buffer.from("v2") },
        { os: "windows", arch: "riscv", buffer: Buffer.from("v2-bad") },
      ]),
    ).toThrow();

    expect(readVersionFile()).toBe("1.0.0");
    expect(readFileSync(sandboxZipPath("1.0.0"), "utf-8")).toBe("content-1.0.0");
    expect(zipsInDir(sandboxDir)).toEqual(["Limacina-1.0.0-windows-x86_64.zip"]);
    expect(zipsInDir(sandboxOldDir)).toEqual([]);
  });

  it("отклоняет невалидную версию до любых мутаций", () => {
    seedBaseline();

    expect(() =>
      service.update("bad-version", [{ os: "windows", arch: "x86_64", buffer: Buffer.from("v2") }]),
    ).toThrow();

    expect(readVersionFile()).toBe("1.0.0");
    expect(zipsInDir(sandboxDir)).toEqual(["Limacina-1.0.0-windows-x86_64.zip"]);
  });

  it("пишет zip до version.json: после успешного update оба обновлены", () => {
    seedBaseline();

    const result = service.update("2.0.0", [
      { os: "windows", arch: "x86_64", buffer: Buffer.from("content-2.0.0") },
    ]);

    expect(result.version).toBe("2.0.0");
    expect(readFileSync(sandboxZipPath("2.0.0"), "utf-8")).toBe("content-2.0.0");
    expect(readVersionFile()).toBe("2.0.0");
    expect(readFileSync(sandboxOldZipPath("1.0.0"), "utf-8")).toBe("content-1.0.0");
  });

  it("пишет version.json атомарно через temp+rename: временных файлов не остаётся", () => {
    seedBaseline();

    service.update("2.1.0", [
      { os: "windows", arch: "x86_64", buffer: Buffer.from("content-2.1.0") },
    ]);

    expect(readVersionFile()).toBe("2.1.0");
    const leftovers = readdirSync("public").filter(
      (file) => file.startsWith("version.json.") && !file.endsWith(".bak"),
    );
    expect(leftovers).toEqual([]);
  });

  it("мультиплатформенный update не оставляет частичного состояния при сбое второй платформы", () => {
    seedBaseline();
    service.update("2.0.0", [
      { os: "windows", arch: "x86_64", buffer: Buffer.from("content-2.0.0") },
    ]);

    expect(() =>
      service.update("3.0.0", [
        { os: "windows", arch: "x86_64", buffer: Buffer.from("content-3.0.0") },
        { os: "macos", arch: "x86_64", buffer: Buffer.from("bad-platform") },
      ]),
    ).toThrow();

    expect(readVersionFile()).toBe("2.0.0");
    expect(existsSync(sandboxZipPath("3.0.0"))).toBe(false);
    expect(readFileSync(sandboxZipPath("2.0.0"), "utf-8")).toBe("content-2.0.0");
    expect(readFileSync(sandboxOldZipPath("1.0.0"), "utf-8")).toBe("content-1.0.0");
  });
});
