import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
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

function captureFileStreamReply(): CapturedFileStream {
  const headers: Record<string, string> = {};
  const statusCodes: number[] = [];
  const streams: Readable[] = [];
  const raw = new EventEmitter();
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

  const openFdTargets = (): string[] => {
    const realPath = resolve(filePath);
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
    expect(openFdTargets()).toEqual([]);
  });

  it("close на raw закрывает fd файла", async () => {
    const { reply, raw } = captureFileStreamReply();

    const done = streamFileToReply(reply, filePath, options);
    await Bun.sleep(10);
    raw.emit("close");
    await done;
    await Bun.sleep(50);

    expect(openFdTargets()).toEqual([]);
  });

  it("повторный close на raw не падает (гард идемпотентности)", async () => {
    const { reply, raw } = captureFileStreamReply();

    const done = streamFileToReply(reply, filePath, options);
    await Bun.sleep(10);
    raw.emit("close");
    raw.emit("close");
    await done;
    await Bun.sleep(50);

    expect(openFdTargets()).toEqual([]);
  });
});
