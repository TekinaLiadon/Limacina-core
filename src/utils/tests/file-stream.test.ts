import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import type { FastifyReply } from "fastify";
import { parseByteRange, streamFileToReply, type FileStreamOptions } from "../file-stream";

describe("parseByteRange", (): void => {
  it("парсит bytes=start-end с клампом конца по размеру файла", () => {
    expect(parseByteRange("bytes=0-3", 10)).toEqual({ start: 0, end: 3 });
    expect(parseByteRange("bytes=2-99", 10)).toEqual({ start: 2, end: 9 });
  });

  it("парсит открытый конец bytes=start-", () => {
    expect(parseByteRange("bytes=4-", 10)).toEqual({ start: 4, end: 9 });
  });

  it("парсит суффикс bytes=-N как последние N байт", () => {
    expect(parseByteRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseByteRange("bytes=-99", 10)).toEqual({ start: 0, end: 9 });
  });

  it("start за пределами файла — unsatisfiable", () => {
    expect(parseByteRange("bytes=10-", 10)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=42-50", 10)).toBe("unsatisfiable");
  });

  it("bytes=-0 — unsatisfiable", () => {
    expect(parseByteRange("bytes=-0", 10)).toBe("unsatisfiable");
  });

  it("мусорные заголовки игнорируются (null — отдать файл целиком)", () => {
    expect(parseByteRange("bytes=abc", 10)).toBeNull();
    expect(parseByteRange("chunks=0-1", 10)).toBeNull();
    expect(parseByteRange("bytes=5-2", 10)).toBeNull();
    expect(parseByteRange("bytes=0-1,3-4", 10)).toBeNull();
  });
});

interface CapturedFileStream {
  reply: FastifyReply;
  headers: Record<string, string>;
  statusCodes: number[];
  streams: Readable[];
  raw: EventEmitter;
}

function captureFileStreamReply(raw: EventEmitter = new EventEmitter()): CapturedFileStream {
  const headers: Record<string, string> = {};
  const statusCodes: number[] = [];
  const streams: Readable[] = [];
  const reply = {
    header: (name: string, value: string) => {
      headers[name] = value;
      return reply;
    },
    code: (code: number) => {
      statusCodes.push(code);
      return reply;
    },
    send: (stream?: Readable) => {
      if (stream !== undefined) streams.push(stream);
    },
    raw,
  } as unknown as FastifyReply;
  return { reply, headers, statusCodes, streams, raw };
}

function createBareServerResponse(): ServerResponse {
  return new ServerResponse(new IncomingMessage(new Socket()));
}

describe("streamFileToReply", () => {
  const dir = mkdtempSync(join(tmpdir(), "file-stream-test-"));
  const filePath = join(dir, "file.bin");
  const fileContent = "0123456789";
  const options: FileStreamOptions = {
    contentType: "application/octet-stream",
    contentDisposition: "attachment",
    notFoundMessage: "нет файла",
    fileLabel: "file.bin",
  };

  const openFdTargetsFor = (path: string): string[] => {
    const realPath = resolve(path);
    return readdirSync("/proc/self/fd")
      .map((fd) => {
        try {
          return readlinkSync(join("/proc/self/fd", fd));
        } catch {
          return "";
        }
      })
      .filter((target) => target === realPath);
  };

  const closeFdSyncFor = (path: string): void => {
    const realPath = resolve(path);
    for (const fd of readdirSync("/proc/self/fd")) {
      try {
        if (readlinkSync(join("/proc/self/fd", fd)) !== realPath) continue;
      } catch {
        continue;
      }
      closeSync(Number(fd));
      return;
    }
  };

  beforeAll(() => {
    writeFileSync(filePath, fileContent);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("отдаёт 206 с Content-Range при валидном Range", async () => {
    const { reply, headers, statusCodes, streams, raw } = captureFileStreamReply();

    await streamFileToReply(reply, filePath, { ...options, rangeHeader: "bytes=2-4" });

    expect(statusCodes).toEqual([206]);
    expect(headers["Content-Range"]).toBe(`bytes 2-4/${fileContent.length}`);
    expect(headers["Content-Length"]).toBe("3");
    expect(headers["Accept-Ranges"]).toBe("bytes");
    expect(streams).toHaveLength(1);
    raw.emit("close");
  });

  it("unsatisfiable Range отвечает 416 и закрывает fd без потока", async () => {
    const { reply, statusCodes, headers, streams } = captureFileStreamReply();

    await streamFileToReply(reply, filePath, { ...options, rangeHeader: "bytes=99-" });
    await Bun.sleep(50);

    expect(statusCodes).toEqual([416]);
    expect(headers["Content-Range"]).toBe(`bytes */${fileContent.length}`);
    expect(streams).toHaveLength(0);
    expect(openFdTargetsFor(filePath)).toEqual([]);
  });

  it("close на raw закрывает fd файла", async () => {
    const { reply, raw } = captureFileStreamReply();

    const done = streamFileToReply(reply, filePath, options);
    await Bun.sleep(10);
    raw.emit("close");
    await done;
    await Bun.sleep(50);

    expect(openFdTargetsFor(filePath)).toEqual([]);
  });

  it("повторный close на raw не падает (гард идемпотентности)", async () => {
    const { reply, raw } = captureFileStreamReply();

    const done = streamFileToReply(reply, filePath, options);
    await Bun.sleep(10);
    raw.emit("close");
    raw.emit("close");
    await done;
    await Bun.sleep(50);

    expect(openFdTargetsFor(filePath)).toEqual([]);
  });

  it("закрывает fd и тихо завершается, если ответ уничтожен во время open (реальный ServerResponse)", async () => {
    const fifoPath = join(dir, "aborted-open.fifo");
    execFileSync("mkfifo", [fifoPath]);
    const raw = createBareServerResponse();
    const { reply, headers, streams } = captureFileStreamReply(raw);

    try {
      const done = streamFileToReply(reply, fifoPath, options);
      await Bun.sleep(20);
      raw.destroy();
      const writer = await open(fifoPath, "w");
      await writer.close();
      await done;
      await Bun.sleep(50);

      expect(headers).toEqual({});
      expect(streams).toEqual([]);
      expect(openFdTargetsFor(fifoPath)).toEqual([]);
    } finally {
      rmSync(fifoPath, { force: true });
    }
  });

  it("закрывает fd и тихо завершается, если ответ уже завершён (writableEnded, реальный ServerResponse)", async () => {
    const endedPath = join(dir, "writable-ended.bin");
    writeFileSync(endedPath, fileContent);
    const raw = createBareServerResponse();
    raw.end();
    const { reply, headers, streams } = captureFileStreamReply(raw);

    await streamFileToReply(reply, endedPath, options);
    await Bun.sleep(50);

    expect(headers).toEqual({});
    expect(streams).toEqual([]);
    expect(openFdTargetsFor(endedPath)).toEqual([]);
  });

  it("тихо завершается при аборте между подпиской на close и stat (EBADF вместо 500)", async () => {
    const raw = {
      destroyed: false,
      once: (event: string): void => {
        if (event !== "close") return;
        closeFdSyncFor(filePath);
        raw.destroyed = true;
      },
    };
    const reply = {
      header: (): void => {},
      code: (): void => {},
      send: (): void => {},
      raw,
    } as unknown as FastifyReply;

    await expect(streamFileToReply(reply, filePath, options)).resolves.toBeUndefined();
    await Bun.sleep(50);
    expect(openFdTargetsFor(filePath)).toEqual([]);
  });

  it("полный путь отдаёт ровно Content-Length байт, даже если файл вырос после stat", async () => {
    const growthPath = join(dir, "growth-after-stat.bin");
    writeFileSync(growthPath, fileContent);
    const { reply, headers, streams, raw } = captureFileStreamReply();

    try {
      const done = streamFileToReply(reply, growthPath, {
        ...options,
        fileLabel: "growth-after-stat.bin",
      });
      await done;
      appendFileSync(growthPath, "grown-after-stat");

      const [bodyStream] = streams;
      if (bodyStream === undefined) throw new Error("поток не захвачен");
      const chunkLengths: number[] = [];
      for await (const chunk of bodyStream) {
        chunkLengths.push((chunk as Uint8Array).length);
      }
      raw.emit("close");
      await Bun.sleep(50);

      const totalBytes = chunkLengths.reduce((sum, length) => sum + length, 0);
      expect(headers["Content-Length"]).toBe(String(fileContent.length));
      expect(totalBytes).toBe(fileContent.length);
      expect(openFdTargetsFor(growthPath)).toEqual([]);
    } finally {
      rmSync(growthPath, { force: true });
    }
  });
});
