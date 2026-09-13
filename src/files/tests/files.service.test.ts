import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { FastifyReply } from "fastify";
import { FilesService } from "../files.service";
import type { FileDto } from "../dto/dto";

const LAUNCHER_DIR = "public/launcher";
const FIXTURE_NAME = "files-watcher-fixture.bin";
const FIXTURE_PATH = join(LAUNCHER_DIR, FIXTURE_NAME);

const files = new FilesService();

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: условие не выполнено за отведённое время");
    }
    await Bun.sleep(50);
  }
}

beforeAll(async () => {
  writeFileSync(FIXTURE_PATH, "bootstrap-content");
  await files.onApplicationBootstrap();
  await Promise.race([
    new Promise<void>((resolve) => {
      files.watcherLauncher.once("ready", resolve);
    }),
    Bun.sleep(1000),
  ]);
});

afterAll(() => {
  rmSync(FIXTURE_PATH, { force: true });
  rmSync(join(LAUNCHER_DIR, `${FIXTURE_NAME}.filepart`), { force: true });
  files.onModuleDestroy();
});

interface CapturedReply {
  reply: FastifyReply;
  headers: Record<string, string>;
  streams: Readable[];
  raw: import("node:events").EventEmitter;
}

function captureReply(): CapturedReply {
  const headers: Record<string, string> = {};
  const streams: Readable[] = [];
  const raw = new EventEmitter();
  const reply = {
    header: (name: string, value: string) => {
      headers[name] = value;
    },
    send: (stream: Readable) => {
      streams.push(stream);
    },
    raw,
  } as unknown as FastifyReply;
  return { reply, headers, streams, raw };
}

describe("FilesService — watcher и стриминг", () => {
  it("bootstrap индексирует файлы и создаёт папку лаунчера", () => {
    expect(existsSync(LAUNCHER_DIR)).toBeTrue();
    expect(files.launcherHash.has(FIXTURE_NAME)).toBeTrue();
  });

  it("getHash отсутствующего файла отвечает null", async () => {
    expect(await files.getHash("public/launcher/missing-file-for-hash.bin")).toBeNull();
  });

  it("watcher подхватывает добавление и изменение файла", async () => {
    writeFileSync(FIXTURE_PATH, "first-content");

    await waitFor(() => files.launcherHash.has(FIXTURE_NAME));
    const firstHash = files.launcherHash.get(FIXTURE_NAME);

    writeFileSync(FIXTURE_PATH, "second-content");
    await waitFor(() => files.launcherHash.get(FIXTURE_NAME) !== firstHash);

    expect(firstHash).toBeDefined();
  });

  it("watcher игнорирует .filepart", async () => {
    writeFileSync(join(LAUNCHER_DIR, `${FIXTURE_NAME}.filepart`), "partial");

    await Bun.sleep(700);

    expect(files.launcherHash.has(`${FIXTURE_NAME}.filepart`)).toBeFalse();
  });

  it("watcher удаляет запись при удалении файла", async () => {
    writeFileSync(FIXTURE_PATH, "to-delete");
    await waitFor(() => files.launcherHash.has(FIXTURE_NAME));
    await Bun.sleep(300);

    rmSync(FIXTURE_PATH);
    await waitFor(() => !files.launcherHash.has(FIXTURE_NAME));
  });

  it("ошибка watcher логируется и не роняет сервис", () => {
    expect(() => files.watcherLauncher.emit("error", new Error("watcher failed"))).not.toThrow();
  });

  it("sendFile отдаёт поток с заголовками и переживает ошибку потока", async () => {
    writeFileSync(FIXTURE_PATH, "stream-body");
    const { reply, headers, streams } = captureReply();
    const fileInfo: FileDto = { url: FIXTURE_NAME };

    await files.sendFile(fileInfo, reply);

    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(headers["Content-Length"]).toBe(String("stream-body".length));
    const [stream] = streams;
    expect(stream).toBeDefined();
    expect(stream?.emit("error", new Error("stream failed"))).toBeTrue();
  });

  it("sendFile отклоняет путь вне папки лаунчера", async () => {
    const { reply } = captureReply();

    await expect(
      files.sendFile({ url: "../textures/default.png" } as FileDto, reply),
    ).rejects.toThrow("Недопустимый путь к файлу");
  });
});
