import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { LauncherUpdateService, type LauncherPlatformFile } from "../launcher-update.service";
import { OLD_VERSIONS_DIR, UPLOAD_TMP_DIR } from "../launcher-files";

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

const stageZip = (os: string, arch: string, content: string): LauncherPlatformFile => {
  mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
  const tempPath = join(UPLOAD_TMP_DIR, `${randomUUID()}.zip`);
  writeFileSync(tempPath, content);
  return { os, arch, tempPath };
};

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
    if (existsSync(OLD_DIR)) {
      const originals = new Set(backedUpFiles.map(({ path }) => path));
      for (const file of readdirSync(OLD_DIR)) {
        const filePath = join(OLD_DIR, file);
        if (file.endsWith(".zip") && !originals.has(filePath)) {
          unlinkSync(filePath);
        }
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
    rmSync(UPLOAD_TMP_DIR, { recursive: true, force: true });
  });

  const resetToBaseline = (): void => {
    service.update("1.0.0", [stageZip("linux", "x86_64", "content-1.0.0")]);
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
    const result = service.update("1.1.0", [stageZip("linux", "x86_64", "content-1.1.0")]);
    createdFiles.push(zipPath("1.1.0"));

    expect(result).toEqual({ version: "1.1.0", updated: ["linux/x86_64"] });
    expect(readFileSync(zipPath("1.1.0"), "utf-8")).toBe("content-1.1.0");
    expect(readFileSync(oldZipPath("1.0.0"), "utf-8")).toBe("content-1.0.0");
    expect(JSON.parse(readFileSync(VERSION_FILE, "utf-8"))).toEqual({ version: "1.1.0" });

    resetToBaseline();
  });

  it("копит несколько версий в old/", () => {
    service.update("1.1.0", [stageZip("linux", "x86_64", "content-1.1.0")]);
    createdFiles.push(zipPath("1.1.0"));
    service.update("1.2.0", [stageZip("linux", "x86_64", "content-1.2.0")]);
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
    service.update("1.2.0", [stageZip("linux", "x86_64", "content-1.2.0")]);
    createdFiles.push(zipPath("1.2.0"));
    service.update("1.2.0", [stageZip("linux", "x86_64", "content-1.2.0-hotfix")]);

    expect(readFileSync(zipPath("1.2.0"), "utf-8")).toBe("content-1.2.0-hotfix");
    expect(existsSync(oldZipPath("1.2.0"))).toBe(false);
    expect(existsSync(oldZipPath("1.0.0"))).toBe(true);

    resetToBaseline();
  });

  it("перезаписывает архивную копию при возврате к старой версии", () => {
    service.update("1.2.0", [stageZip("linux", "x86_64", "content-1.2.0")]);
    createdFiles.push(zipPath("1.2.0"));
    service.update("1.3.0", [stageZip("linux", "x86_64", "content-1.3.0")]);
    createdFiles.push(zipPath("1.3.0"));
    expect(existsSync(oldZipPath("1.2.0"))).toBe(true);

    service.update("1.2.0", [stageZip("linux", "x86_64", "content-1.2.0-again")]);

    expect(readFileSync(zipPath("1.2.0"), "utf-8")).toBe("content-1.2.0-again");
    expect(existsSync(zipPath("1.3.0"))).toBe(false);
    expect(existsSync(oldZipPath("1.3.0"))).toBe(true);

    resetToBaseline();
  });

  it("переименовывает temp-файл: в .upload-tmp ничего не остаётся", () => {
    service.update("1.4.0", [stageZip("linux", "x86_64", "content-1.4.0")]);
    createdFiles.push(zipPath("1.4.0"));

    expect(existsSync(UPLOAD_TMP_DIR) ? readdirSync(UPLOAD_TMP_DIR) : []).toEqual([]);

    resetToBaseline();
  });

  it("PATCH без файловых полей отклоняется и не трогает version.json (TASK-411.7)", () => {
    const versionBefore = existsSync(VERSION_FILE)
      ? readFileSync(VERSION_FILE, "utf-8")
      : undefined;

    expect(() => service.update("9.9.9", [])).toThrow(BadRequestException);

    const versionAfter = existsSync(VERSION_FILE) ? readFileSync(VERSION_FILE, "utf-8") : undefined;
    expect(versionAfter).toBe(versionBefore);
    expect(existsSync(zipPath("9.9.9"))).toBe(false);
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
    rmSync(UPLOAD_TMP_DIR, { recursive: true, force: true });
  });

  it("создаёт zip для macos/arm64", () => {
    const result = service.update("1.0.0", [stageZip("macos", "arm64", "macos-content")]);

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
    rmSync(UPLOAD_TMP_DIR, { recursive: true, force: true });
  });

  it("отклоняет невалидную платформу до любых мутаций: version.json и zip не тронуты", () => {
    seedBaseline();

    expect(() =>
      service.update("2.0.0", [
        stageZip("windows", "x86_64", "v2"),
        stageZip("windows", "riscv", "v2-bad"),
      ]),
    ).toThrow();

    expect(readVersionFile()).toBe("1.0.0");
    expect(readFileSync(sandboxZipPath("1.0.0"), "utf-8")).toBe("content-1.0.0");
    expect(zipsInDir(sandboxDir)).toEqual(["Limacina-1.0.0-windows-x86_64.zip"]);
    expect(zipsInDir(sandboxOldDir)).toEqual([]);
    expect(existsSync(UPLOAD_TMP_DIR) ? readdirSync(UPLOAD_TMP_DIR) : []).toEqual([]);
  });

  it("отклоняет невалидную версию до любых мутаций", () => {
    seedBaseline();

    expect(() => service.update("bad-version", [stageZip("windows", "x86_64", "v2")])).toThrow();

    expect(readVersionFile()).toBe("1.0.0");
    expect(zipsInDir(sandboxDir)).toEqual(["Limacina-1.0.0-windows-x86_64.zip"]);
  });

  it("пишет zip до version.json: после успешного update оба обновлены", () => {
    seedBaseline();

    const result = service.update("2.0.0", [stageZip("windows", "x86_64", "content-2.0.0")]);

    expect(result.version).toBe("2.0.0");
    expect(readFileSync(sandboxZipPath("2.0.0"), "utf-8")).toBe("content-2.0.0");
    expect(readVersionFile()).toBe("2.0.0");
    expect(readFileSync(sandboxOldZipPath("1.0.0"), "utf-8")).toBe("content-1.0.0");
  });

  it("пишет version.json атомарно через temp+rename: временных файлов не остаётся", () => {
    seedBaseline();

    service.update("2.1.0", [stageZip("windows", "x86_64", "content-2.1.0")]);

    expect(readVersionFile()).toBe("2.1.0");
    const leftovers = readdirSync("public").filter(
      (file) => file.startsWith("version.json.") && !file.endsWith(".bak"),
    );
    expect(leftovers).toEqual([]);
  });

  it("битый version.json + update без версии даёт понятную ошибку и ничего не публикует (TASK-267.11)", () => {
    seedBaseline();
    writeFileSync(VERSION_FILE, "{broken");

    expect(() => service.update("", [stageZip("windows", "x86_64", "v2")])).toThrow(
      BadRequestException,
    );

    expect(readFileSync(VERSION_FILE, "utf-8")).toBe("{broken");
    expect(zipsInDir(sandboxDir)).toEqual(["Limacina-1.0.0-windows-x86_64.zip"]);
    expect(existsSync(UPLOAD_TMP_DIR) ? readdirSync(UPLOAD_TMP_DIR) : []).toEqual([]);
  });

  it("отсутствующий version.json + update без версии даёт ошибку и не создаёт файл", () => {
    seedBaseline();
    unlinkSync(VERSION_FILE);

    expect(() => service.update("", [stageZip("windows", "x86_64", "v2")])).toThrow(
      BadRequestException,
    );

    expect(existsSync(VERSION_FILE)).toBe(false);
    expect(zipsInDir(sandboxDir)).toEqual(["Limacina-1.0.0-windows-x86_64.zip"]);
  });

  it("version.json без строковой версии в форме x.x.x не публикует 0.0.0", () => {
    seedBaseline();
    writeFileSync(VERSION_FILE, JSON.stringify({ version: 123 }));

    expect(() => service.update("", [stageZip("windows", "x86_64", "v2")])).toThrow(
      BadRequestException,
    );

    expect(JSON.parse(readFileSync(VERSION_FILE, "utf-8"))).toEqual({ version: 123 });
    expect(zipsInDir(sandboxDir)).toEqual(["Limacina-1.0.0-windows-x86_64.zip"]);
  });

  it("явная версия публикуется и при битом version.json", () => {
    seedBaseline();
    writeFileSync(VERSION_FILE, "{broken");

    const result = service.update("5.0.0", [stageZip("windows", "x86_64", "content-5.0.0")]);

    expect(result.version).toBe("5.0.0");
    expect(readVersionFile()).toBe("5.0.0");
    expect(readFileSync(sandboxZipPath("5.0.0"), "utf-8")).toBe("content-5.0.0");
  });

  it("версия 0.0.0 зарезервирована: не публикуется явно и не подставляется из version.json", () => {
    seedBaseline();

    expect(() => service.update("0.0.0", [stageZip("windows", "x86_64", "v2")])).toThrow(
      /зарезервирована/,
    );
    expect(readVersionFile()).toBe("1.0.0");

    writeFileSync(VERSION_FILE, JSON.stringify({ version: "0.0.0" }));
    expect(() => service.update("", [stageZip("windows", "x86_64", "v2")])).toThrow(
      BadRequestException,
    );
    expect(zipsInDir(sandboxDir)).toEqual(["Limacina-1.0.0-windows-x86_64.zip"]);
  });

  it("откатывает zip-файлы при сбое записи version.json", () => {
    seedBaseline();

    chmodSync("public", 0o555);
    try {
      expect(() =>
        service.update("4.0.0", [stageZip("windows", "x86_64", "content-4.0.0")]),
      ).toThrow();
    } finally {
      chmodSync("public", 0o755);
    }

    expect(readVersionFile()).toBe("1.0.0");
    expect(readFileSync(sandboxZipPath("1.0.0"), "utf-8")).toBe("content-1.0.0");
    expect(existsSync(sandboxZipPath("4.0.0"))).toBe(false);
    expect(zipsInDir(sandboxOldDir)).toEqual([]);
    expect(existsSync(UPLOAD_TMP_DIR) ? readdirSync(UPLOAD_TMP_DIR) : []).toEqual([]);
  });

  it("сбой записи version.json при перезаливке той же версии не теряет текущий zip", () => {
    seedBaseline();

    mkdirSync(join("public", "version.json.tmp"), { recursive: true });
    try {
      expect(() =>
        service.update("1.0.0", [stageZip("windows", "x86_64", "content-1.0.0-hotfix")]),
      ).toThrow();
    } finally {
      rmdirSync(join("public", "version.json.tmp"));
    }

    expect(readVersionFile()).toBe("1.0.0");
    expect(readFileSync(sandboxZipPath("1.0.0"), "utf-8")).toBe("content-1.0.0");
    expect(existsSync(`${sandboxZipPath("1.0.0")}.replaced`)).toBe(false);
    expect(zipsInDir(sandboxDir)).toEqual(["Limacina-1.0.0-windows-x86_64.zip"]);
    expect(zipsInDir(sandboxOldDir)).toEqual([]);
    expect(existsSync(UPLOAD_TMP_DIR) ? readdirSync(UPLOAD_TMP_DIR) : []).toEqual([]);
  });

  it("сбой архивации посередине возвращает перенесённые в old/ файлы на место", () => {
    seedBaseline();
    writeFileSync(sandboxZipPath("0.9.0"), "content-0.9.0");

    const internals = service as unknown as {
      moveZipToArchive: (dir: string, file: string) => void;
    };
    const originalMove = internals.moveZipToArchive;
    let moves = 0;
    internals.moveZipToArchive = (dir: string, file: string): void => {
      moves += 1;
      if (moves === 2) throw new Error("сбой посреди архивации");
      originalMove.call(service, dir, file);
    };

    try {
      expect(() =>
        service.update("2.0.0", [stageZip("windows", "x86_64", "content-2.0.0")]),
      ).toThrow("сбой посреди архивации");
    } finally {
      internals.moveZipToArchive = originalMove;
    }

    expect(readVersionFile()).toBe("1.0.0");
    expect(zipsInDir(sandboxDir)).toEqual([
      "Limacina-0.9.0-windows-x86_64.zip",
      "Limacina-1.0.0-windows-x86_64.zip",
    ]);
    expect(zipsInDir(sandboxOldDir)).toEqual([]);
  });

  it("сбой перезаливки zip после архивации откатывает перенесённые в old/ файлы", () => {
    seedBaseline();

    const internals = service as unknown as {
      replaceExistingZip?: (dir: string, filename: string) => string | undefined;
    };
    internals.replaceExistingZip = (): never => {
      throw new Error("сбой перезаливки");
    };

    try {
      expect(() =>
        service.update("2.0.0", [stageZip("windows", "x86_64", "content-2.0.0")]),
      ).toThrow("сбой перезаливки");
    } finally {
      delete internals.replaceExistingZip;
    }

    expect(readVersionFile()).toBe("1.0.0");
    expect(zipsInDir(sandboxDir)).toEqual(["Limacina-1.0.0-windows-x86_64.zip"]);
    expect(zipsInDir(sandboxOldDir)).toEqual([]);
  });

  it("сбой переименования temp-файла откатывает архивацию old/ — текущий zip на месте", () => {
    seedBaseline();

    const missingTempPath = join(UPLOAD_TMP_DIR, "missing.zip");
    expect(() =>
      service.update("2.0.0", [{ os: "windows", arch: "x86_64", tempPath: missingTempPath }]),
    ).toThrow();

    expect(readVersionFile()).toBe("1.0.0");
    expect(readFileSync(sandboxZipPath("1.0.0"), "utf-8")).toBe("content-1.0.0");
    expect(zipsInDir(sandboxDir)).toEqual(["Limacina-1.0.0-windows-x86_64.zip"]);
    expect(zipsInDir(sandboxOldDir)).toEqual([]);
  });

  it("мультиплатформенный update не оставляет частичного состояния при сбое второй платформы", () => {
    seedBaseline();
    service.update("2.0.0", [stageZip("windows", "x86_64", "content-2.0.0")]);

    expect(() =>
      service.update("3.0.0", [
        stageZip("windows", "x86_64", "content-3.0.0"),
        stageZip("macos", "x86_64", "bad-platform"),
      ]),
    ).toThrow();

    expect(readVersionFile()).toBe("2.0.0");
    expect(existsSync(sandboxZipPath("3.0.0"))).toBe(false);
    expect(readFileSync(sandboxZipPath("2.0.0"), "utf-8")).toBe("content-2.0.0");
    expect(readFileSync(sandboxOldZipPath("1.0.0"), "utf-8")).toBe("content-1.0.0");
    expect(existsSync(UPLOAD_TMP_DIR) ? readdirSync(UPLOAD_TMP_DIR) : []).toEqual([]);
  });
});
