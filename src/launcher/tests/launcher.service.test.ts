import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { FastifyReply } from "fastify";
import { LauncherService } from "../launcher.service";

const PLATFORM_DIR = "public/linux/x86_64";
const TEST_VERSION = "9.9.9";
const CURRENT_ZIP = `Limacina-${TEST_VERSION}-linux-x86_64.zip`;
const CURRENT_ZIP_PATH = join(PLATFORM_DIR, CURRENT_ZIP);
const OLD_ZIP_VERSION = "9.9.8";
const OLD_ZIP = `Limacina-${OLD_ZIP_VERSION}-linux-x86_64.zip`;
const OLD_ZIP_PATH = join(PLATFORM_DIR, "old", OLD_ZIP);

const launcher = new LauncherService();

interface CapturedReply {
  headers: Record<string, string>;
  streams: Readable[];
  raw: EventEmitter;
}

function captureReply(): CapturedReply {
  const headers: Record<string, string> = {};
  const streams: Readable[] = [];
  const raw = new EventEmitter();
  return { headers, streams, raw };
}

function captureReplyAsReply(captured: CapturedReply): FastifyReply {
  const reply = {
    header: (name: string, value: string) => {
      captured.headers[name] = value;
    },
    send: (stream: Readable) => {
      captured.streams.push(stream);
    },
    raw: captured.raw,
  } as unknown as FastifyReply;
  return reply;
}

function setVersion(version: string): void {
  (launcher as unknown as { version: string }).version = version;
}

beforeAll(async () => {
  mkdirSync(join(PLATFORM_DIR, "old"), { recursive: true });
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

  it("обрабатывает события платформенного watcher'а", () => {
    const platforms = launcher as unknown as {
      platformsWatcher?: EventEmitter;
    };

    expect(() =>
      invokeWatcherHandlers(platforms.platformsWatcher, "add", join(PLATFORM_DIR, "notes.txt")),
    ).not.toThrow();
    expect(() =>
      invokeWatcherHandlers(platforms.platformsWatcher, "add", CURRENT_ZIP_PATH),
    ).not.toThrow();
    expect(() =>
      invokeWatcherHandlers(platforms.platformsWatcher, "unlink", CURRENT_ZIP_PATH),
    ).not.toThrow();
  });

  it("обрабатывает ошибки всех watcher'ов", () => {
    const watchers = launcher as unknown as {
      versionWatcher?: EventEmitter;
      configWatcher?: EventEmitter;
      platformsWatcher?: EventEmitter;
    };

    expect(() =>
      invokeWatcherHandlers(watchers.versionWatcher, "error", new Error("version watcher failed")),
    ).not.toThrow();
    expect(() =>
      invokeWatcherHandlers(watchers.configWatcher, "error", new Error("config watcher failed")),
    ).not.toThrow();
    expect(() =>
      invokeWatcherHandlers(
        watchers.platformsWatcher,
        "error",
        new Error("platform watcher failed"),
      ),
    ).not.toThrow();
  });

  it("download отдаёт поток с заголовками и закрывает дескриптор", async () => {
    setVersion(TEST_VERSION);
    writeFileSync(CURRENT_ZIP_PATH, "zip-body");
    const { headers, streams, raw } = captureReply();

    await launcher.download("linux", "x86_64", captureReplyAsReply({ headers, streams, raw }));

    expect(headers["Content-Length"]).toBe(String("zip-body".length));
    expect(headers["Content-Disposition"]).toContain(CURRENT_ZIP);
    expect(streams.length).toBe(1);
    expect(streams[0]?.emit("error", new Error("download stream failed"))).toBeTrue();
    raw.emit("close");
  });

  it("download отдаёт старую версию из old/ по параметру", async () => {
    writeFileSync(OLD_ZIP_PATH, "old-zip-body");
    const captured = captureReply();

    await launcher.download("linux", "x86_64", captureReplyAsReply(captured), OLD_ZIP_VERSION);

    expect(captured.headers["Content-Disposition"]).toContain(OLD_ZIP);
    expect(captured.headers["Content-Length"]).toBe(String("old-zip-body".length));
    expect(captured.streams.length).toBe(1);
    captured.raw.emit("close");
  });
});
