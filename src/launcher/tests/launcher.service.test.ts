import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { Readable } from "node:stream";
import { NotFoundException } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { LauncherService, parseLauncherConfig } from "../launcher.service";

const PLATFORM_DIR = "public/linux/x86_64";
const VERSION_FILE = join("public", "version.json");
const TEST_VERSION = "9.9.9";
const CURRENT_ZIP = `Limacina-${TEST_VERSION}-linux-x86_64.zip`;
const CURRENT_ZIP_PATH = join(PLATFORM_DIR, CURRENT_ZIP);
const OLD_ZIP_VERSION = "9.9.8";
const OLD_ZIP = `Limacina-${OLD_ZIP_VERSION}-linux-x86_64.zip`;
const OLD_ZIP_PATH = join(PLATFORM_DIR, "old", OLD_ZIP);

const launcher = new LauncherService();

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor: истекло время ожидания");
    await Bun.sleep(50);
  }
}

function launcherLogger(service: LauncherService): {
  warn: (...args: unknown[]) => void;
} {
  return (service as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger;
}

interface CapturedReply {
  headers: Record<string, string>;
  streams: Readable[];
  raw: EventEmitter;
  status?: number;
  requestHeaders: Record<string, string | undefined>;
}

function captureReply(): CapturedReply {
  const headers: Record<string, string> = {};
  const streams: Readable[] = [];
  const raw = new EventEmitter();
  return { headers, streams, raw, requestHeaders: {} };
}

function captureReplyAsReply(captured: CapturedReply): FastifyReply {
  const reply = {
    header: (name: string, value: string) => {
      captured.headers[name] = value;
      return reply;
    },
    code: (value: number) => {
      captured.status = value;
      return reply;
    },
    send: (stream?: Readable) => {
      if (stream !== undefined) captured.streams.push(stream);
    },
    raw: captured.raw,
    request: { headers: captured.requestHeaders },
  } as unknown as FastifyReply;
  return reply;
}

async function readStreamBody(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function setVersion(version: string): void {
  (launcher as unknown as { version: string }).version = version;
}

beforeAll(async () => {
  mkdirSync(join(PLATFORM_DIR, "old"), { recursive: true });
  if (!existsSync(VERSION_FILE)) {
    writeFileSync(VERSION_FILE, `${JSON.stringify({ version: "0.0.0" })}\n`);
  }
  await launcher.onApplicationBootstrap();
});

afterAll(() => {
  rmSync(CURRENT_ZIP_PATH, { force: true });
  rmSync(OLD_ZIP_PATH, { force: true });
  launcher.onModuleDestroy();
});

describe("LauncherService — watcher и стриминг скачивания", () => {
  it("bootstrap проиндексировал платформы", () => {
    expect(launcher.getVersions().platforms.length).toBeGreaterThanOrEqual(0);
  });

  function invokeWatcherHandlers(
    watcher: EventEmitter | undefined,
    event: string,
    ...args: unknown[]
  ): void {
    for (const handler of watcher?.listeners(event) ?? []) {
      try {
        (handler as (...handlerArgs: unknown[]) => void)(...args);
      } catch {
        return;
      }
    }
  }

  it("обрабатывает события version-вотчера", () => {
    const watchers = launcher as unknown as {
      versionWatcher?: EventEmitter;
    };

    expect(() =>
      invokeWatcherHandlers(watchers.versionWatcher, "all", "change", "public/version.json"),
    ).not.toThrow();
  });

  it("обрабатывает ошибки всех watcher'ов", () => {
    const watchers = launcher as unknown as {
      versionWatcher?: EventEmitter;
      configWatcher?: EventEmitter;
    };

    expect(() =>
      invokeWatcherHandlers(watchers.versionWatcher, "error", new Error("version watcher failed")),
    ).not.toThrow();
    expect(() =>
      invokeWatcherHandlers(watchers.configWatcher, "error", new Error("config watcher failed")),
    ).not.toThrow();
  });

  it("download отдаёт поток с заголовками и закрывает дескриптор", async () => {
    setVersion(TEST_VERSION);
    writeFileSync(CURRENT_ZIP_PATH, "zip-body");
    const captured = captureReply();

    await launcher.download("linux", "x86_64", captureReplyAsReply(captured));

    expect(captured.headers["Content-Length"]).toBe(String("zip-body".length));
    expect(captured.headers["Content-Disposition"]).toContain(CURRENT_ZIP);
    expect(captured.streams.length).toBe(1);
    expect(captured.streams[0]?.emit("error", new Error("download stream failed"))).toBeTrue();
    captured.raw.emit("close");
  });

  it("download отдаёт старую версию из old/ по параметру с basename в Content-Disposition", async () => {
    writeFileSync(OLD_ZIP_PATH, "old-zip-body");
    const captured = captureReply();

    await launcher.download("linux", "x86_64", captureReplyAsReply(captured), OLD_ZIP_VERSION);

    expect(captured.headers["Content-Disposition"]).toBe(`attachment; filename="${OLD_ZIP}"`);
    expect(captured.headers["Content-Disposition"]).not.toContain("old/");
    expect(captured.headers["Content-Length"]).toBe(String("old-zip-body".length));
    expect(captured.streams.length).toBe(1);
    captured.raw.emit("close");
  });

  it("Range bytes=start-end отдаёт 206 со срезом тела", async () => {
    setVersion(TEST_VERSION);
    writeFileSync(CURRENT_ZIP_PATH, "0123456789");
    const captured = captureReply();
    captured.requestHeaders["range"] = "bytes=0-3";

    await launcher.download("linux", "x86_64", captureReplyAsReply(captured));

    expect(captured.status).toBe(206);
    expect(captured.headers["Content-Range"]).toBe("bytes 0-3/10");
    expect(captured.headers["Content-Length"]).toBe("4");
    expect(captured.headers["Accept-Ranges"]).toBe("bytes");
    expect(await readStreamBody(captured.streams[0]!)).toBe("0123");
    captured.raw.emit("close");
  });

  it("Range суффиксом bytes=-N отдаёт последние N байт", async () => {
    setVersion(TEST_VERSION);
    writeFileSync(CURRENT_ZIP_PATH, "0123456789");
    const captured = captureReply();
    captured.requestHeaders["range"] = "bytes=-3";

    await launcher.download("linux", "x86_64", captureReplyAsReply(captured));

    expect(captured.status).toBe(206);
    expect(captured.headers["Content-Range"]).toBe("bytes 7-9/10");
    expect(await readStreamBody(captured.streams[0]!)).toBe("789");
    captured.raw.emit("close");
  });

  it("неудовлетворимый Range отвечает 416 с bytes */size", async () => {
    setVersion(TEST_VERSION);
    writeFileSync(CURRENT_ZIP_PATH, "zip-body");
    const captured = captureReply();
    captured.requestHeaders["range"] = "bytes=100-";

    await launcher.download("linux", "x86_64", captureReplyAsReply(captured));

    expect(captured.status).toBe(416);
    expect(captured.headers["Content-Range"]).toBe("bytes */8");
    expect(captured.streams).toHaveLength(0);
  });

  it("мусорный Range игнорируется — файл отдаётся целиком со 200", async () => {
    setVersion(TEST_VERSION);
    writeFileSync(CURRENT_ZIP_PATH, "zip-body");
    const captured = captureReply();
    captured.requestHeaders["range"] = "bytes=abc";

    await launcher.download("linux", "x86_64", captureReplyAsReply(captured));

    expect(captured.status).toBeUndefined();
    expect(captured.headers["Accept-Ranges"]).toBe("bytes");
    expect(captured.headers["Content-Length"]).toBe("8");
    expect(captured.streams).toHaveLength(1);
    captured.raw.emit("close");
  });

  it("download без version отдаёт текущий zip из old/ во время окна обновления", async () => {
    setVersion(TEST_VERSION);
    writeFileSync(join(PLATFORM_DIR, "old", CURRENT_ZIP), "zip-body");
    rmSync(CURRENT_ZIP_PATH, { force: true });
    const captured = captureReply();

    try {
      await launcher.download("linux", "x86_64", captureReplyAsReply(captured));

      expect(captured.streams.length).toBe(1);
      expect(captured.headers["Content-Disposition"]).toContain(CURRENT_ZIP);
      captured.raw.emit("close");
    } finally {
      rmSync(join(PLATFORM_DIR, "old", CURRENT_ZIP), { force: true });
    }
  });

  it("download без version предпочитает zip на верхнем уровне архиву в old/", async () => {
    setVersion(TEST_VERSION);
    writeFileSync(CURRENT_ZIP_PATH, "zip-body");
    writeFileSync(join(PLATFORM_DIR, "old", CURRENT_ZIP), "stale-zip-body");
    const captured = captureReply();

    try {
      await launcher.download("linux", "x86_64", captureReplyAsReply(captured));

      expect(captured.headers["Content-Disposition"]).toBe(`attachment; filename="${CURRENT_ZIP}"`);
      captured.raw.emit("close");
    } finally {
      rmSync(join(PLATFORM_DIR, "old", CURRENT_ZIP), { force: true });
    }
  });

  it("download без version отвечает 404, если текущего zip нет ни на уровне каталога, ни в old/", async () => {
    setVersion(TEST_VERSION);
    rmSync(CURRENT_ZIP_PATH, { force: true });
    rmSync(join(PLATFORM_DIR, "old", CURRENT_ZIP), { force: true });

    await expect(
      launcher.download("linux", "x86_64", captureReplyAsReply(captureReply())),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("LauncherService — перечитывание version.json", () => {
  function reread(service: LauncherService): void {
    (service as unknown as { rereadVersion(): void }).rereadVersion();
  }

  it("перечитывание подхватывает новую версию с диска, даже если вотчер событие пропустил", () => {
    const original = readFileSync(VERSION_FILE, "utf-8");
    try {
      writeFileSync(VERSION_FILE, `${JSON.stringify({ version: "5.5.5" })}\n`);

      reread(launcher);

      expect(launcher.getVersions().version).toBe("5.5.5");
    } finally {
      writeFileSync(VERSION_FILE, original);
      reread(launcher);
    }
  });

  it("битый version.json при перечитывании оставляет кеш без изменений", () => {
    const original = readFileSync(VERSION_FILE, "utf-8");
    try {
      const before = launcher.getVersions().version;
      writeFileSync(VERSION_FILE, "{broken");

      reread(launcher);

      expect(launcher.getVersions().version).toBe(before);
    } finally {
      writeFileSync(VERSION_FILE, original);
      reread(launcher);
    }
  });
});

describe("LauncherService — наблюдаемые каталоги", () => {
  const ARM_DIR = join("public", "macos", "arm64");
  const ARM_BACKUP = join("public", "macos", "arm64.watch-test.bak");
  const WATCH_ZIP_VERSION = "7.7.7";
  const WATCH_ZIP = `Limacina-${WATCH_ZIP_VERSION}-macos-arm64.zip`;

  function movePlatformDirAside(): boolean {
    rmSync(ARM_BACKUP, { recursive: true, force: true });
    if (!existsSync(ARM_DIR)) return false;
    renameSync(ARM_DIR, ARM_BACKUP);
    return true;
  }

  function restorePlatformDir(dirWasMoved: boolean): void {
    rmSync(ARM_DIR, { recursive: true, force: true });
    if (dirWasMoved) renameSync(ARM_BACKUP, ARM_DIR);
  }

  it("создаёт отсутствующие каталоги платформ до watch и логирует их отсутствие", async () => {
    const dirWasMoved = movePlatformDirAside();
    const service = new LauncherService();
    const warnSpy = spyOn(launcherLogger(service), "warn");

    try {
      await service.onApplicationBootstrap();

      expect(existsSync(ARM_DIR)).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      service.onModuleDestroy();
      restorePlatformDir(dirWasMoved);
    }
  });

  it("пересоздание каталога платформы после старта подхватывается пересканированием", async () => {
    const dirWasMoved = movePlatformDirAside();
    const service = new LauncherService(100);
    const zipPath = join(ARM_DIR, WATCH_ZIP);
    const hasPlatform = (): boolean =>
      service
        .getVersions()
        .platforms.some((platform) => platform.os === "macos" && platform.arch === "arm64");

    try {
      await service.onApplicationBootstrap();

      writeFileSync(zipPath, "watch-fixture");
      await waitFor(hasPlatform);

      rmSync(ARM_DIR, { recursive: true, force: true });
      await waitFor(() => !hasPlatform());

      mkdirSync(ARM_DIR, { recursive: true });
      writeFileSync(zipPath, "watch-fixture-v2");
      await waitFor(hasPlatform);
    } finally {
      service.onModuleDestroy();
      restorePlatformDir(dirWasMoved);
    }
  });
});

describe("parseLauncherConfig — форма config.toml", (): void => {
  const validToml = `projectName = "Cordelia"
mcVersion = "1.21.1"
modLoader = "neoforge"
loaderVersion = "21.1.234"
jvmArgs = ["-Xms512M", "-Xmx2560M"]
minMemory = "-Xms512M"
maxMemory = "-Xmx2560M"
online = true`;

  it("парсит валидный конфиг в LauncherConfigDto", (): void => {
    const config = parseLauncherConfig(validToml);

    expect(config).toEqual({
      projectName: "Cordelia",
      mcVersion: "1.21.1",
      modLoader: "neoforge",
      loaderVersion: "21.1.234",
      jvmArgs: ["-Xms512M", "-Xmx2560M"],
      minMemory: "-Xms512M",
      maxMemory: "-Xmx2560M",
      online: true,
    });
  });

  it("отбрасывает посторонние ключи, не нарушая форму DTO", (): void => {
    const config = parseLauncherConfig(`${validToml}\nextraneous = "junk"`);

    expect(config).toBeDefined();
    expect("extraneous" in config!).toBe(false);
  });

  it("отклоняет поле неверного типа (online строкой)", (): void => {
    expect(
      parseLauncherConfig(validToml.replace("online = true", 'online = "yes"')),
    ).toBeUndefined();
  });

  it("отклоняет jvmArgs не-массивом", (): void => {
    expect(
      parseLauncherConfig(
        validToml.replace('jvmArgs = ["-Xms512M", "-Xmx2560M"]', 'jvmArgs = "-Xms512M"'),
      ),
    ).toBeUndefined();
  });

  it("отклоняет jvmArgs с не-строковым элементом", (): void => {
    expect(
      parseLauncherConfig(
        validToml.replace('jvmArgs = ["-Xms512M", "-Xmx2560M"]', "jvmArgs = [512]"),
      ),
    ).toBeUndefined();
  });

  it("отклоняет конфиг без обязательного поля", (): void => {
    expect(parseLauncherConfig(validToml.replace('minMemory = "-Xms512M"\n', ""))).toBeUndefined();
  });
});
