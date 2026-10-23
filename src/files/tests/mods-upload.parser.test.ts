import { setupTestEnv } from "../../utils/tests/test-env";
import { UPLOAD_TMP_DIR } from "../../launcher/launcher-files";

setupTestEnv();

import { afterEach, describe, expect, it } from "bun:test";
import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import type { FastifyRequest } from "fastify";
import {
  MAX_MOD_FILE_BYTES,
  normalizeModEntryName,
  normalizeModUploadName,
  parseModsUploadRequest,
} from "../mods-upload.parser";

interface FakePart {
  type: "field" | "file";
  fieldname: string;
  value?: string;
  file?: NodeJS.ReadableStream;
  filename?: string;
}

function buildFakeRequest(parts: FakePart[]): FastifyRequest {
  async function* iterateParts() {
    for (const part of parts) yield part;
  }
  return { parts: (_options?: unknown) => iterateParts() } as unknown as FastifyRequest;
}

function filePart(fieldname: string, filename: string, content: string): FakePart {
  return {
    type: "file",
    fieldname,
    filename,
    file: Readable.from([Buffer.from(content)]),
  };
}

afterEach((): void => {
  if (existsSync(UPLOAD_TMP_DIR)) {
    rmSync(UPLOAD_TMP_DIR, { recursive: true, force: true });
  }
});

describe("normalizeModUploadName", (): void => {
  it("принимает .jar в любом регистре и сохраняет исходное имя", (): void => {
    expect(normalizeModUploadName("JEI-1.21.1.jar")).toBe("JEI-1.21.1.jar");
    expect(normalizeModUploadName("mod.JAR")).toBe("mod.JAR");
  });

  it("отклоняет файлы без расширения .jar", (): void => {
    expect(() => normalizeModUploadName("mod.zip")).toThrow(BadRequestException);
    expect(() => normalizeModUploadName("mod")).toThrow(BadRequestException);
  });

  it("отклоняет имена с путём и скрытые имена", (): void => {
    expect(() => normalizeModUploadName("../evil.jar")).toThrow(BadRequestException);
    expect(() => normalizeModUploadName("nested/evil.jar")).toThrow(BadRequestException);
    expect(() => normalizeModUploadName("nested\\evil.jar")).toThrow(BadRequestException);
    expect(() => normalizeModUploadName(".hidden.jar")).toThrow(BadRequestException);
  });

  it("отклоняет пустое имя", (): void => {
    expect(() => normalizeModUploadName(undefined)).toThrow(BadRequestException);
    expect(() => normalizeModUploadName("   ")).toThrow(BadRequestException);
  });

  it("отклоняет имя длиннее 255 байт", (): void => {
    expect(() => normalizeModUploadName(`${"a".repeat(252)}.jar`)).toThrow(BadRequestException);
  });
});

describe("normalizeModEntryName", (): void => {
  it("разрешает произвольные имена файлов внутри папки модов", (): void => {
    expect(normalizeModEntryName("mod.jar.disabled")).toBe("mod.jar.disabled");
  });

  it("отклоняет выход за пределы папки модов", (): void => {
    expect(() => normalizeModEntryName("../secret.txt")).toThrow(BadRequestException);
    expect(() => normalizeModEntryName("..\\secret.txt")).toThrow(BadRequestException);
  });
});

describe("parseModsUploadRequest", (): void => {
  it("принимает несколько .jar и складывает содержимое в temp", async (): Promise<void> => {
    const request = buildFakeRequest([
      { type: "field", fieldname: "comment", value: "ignored" },
      filePart("file", "first.jar", "first-bytes"),
      filePart("files", "second.jar", "second-bytes"),
    ]);

    const uploads = await parseModsUploadRequest(request);

    expect(uploads.map((upload) => upload.name)).toEqual(["first.jar", "second.jar"]);
    expect(readFileSync(uploads[0]!.tempPath, "utf-8")).toBe("first-bytes");
    expect(readFileSync(uploads[1]!.tempPath, "utf-8")).toBe("second-bytes");
  });

  it("передаёт плагину multipart лимит размера файла", async (): Promise<void> => {
    let capturedOptions: unknown;
    const request = {
      parts: (options?: unknown) => {
        capturedOptions = options;
        return (async function* () {})();
      },
    } as unknown as FastifyRequest;

    await parseModsUploadRequest(request).catch(() => undefined);

    expect(capturedOptions).toEqual({ limits: { fileSize: MAX_MOD_FILE_BYTES } });
  });

  it("отклоняет запрос без файлов", async (): Promise<void> => {
    const request = buildFakeRequest([{ type: "field", fieldname: "comment", value: "none" }]);

    await expect(parseModsUploadRequest(request)).rejects.toThrow("хотя бы один файл мода");
  });

  it("отклоняет не-.jar и подчищает уже записанные temp", async (): Promise<void> => {
    mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
    const request = buildFakeRequest([
      filePart("file", "valid.jar", "bytes"),
      filePart("file", "invalid.zip", "bytes"),
    ]);

    await expect(parseModsUploadRequest(request)).rejects.toBeInstanceOf(BadRequestException);
    expect(readdirSync(UPLOAD_TMP_DIR)).toEqual([]);
  });

  it("отклоняет файл без имени", async (): Promise<void> => {
    const request = buildFakeRequest([
      { type: "file", fieldname: "file", file: Readable.from([Buffer.from("bytes")]) },
    ]);

    await expect(parseModsUploadRequest(request)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("отклоняет повторное имя файла", async (): Promise<void> => {
    const request = buildFakeRequest([
      filePart("file", "same.jar", "one"),
      filePart("file", "same.jar", "two"),
    ]);

    await expect(parseModsUploadRequest(request)).rejects.toThrow("Повторное имя файла мода");
  });

  it("файл больше лимита отклоняется как 413 и temp чистится", async (): Promise<void> => {
    mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
    const chunk = Buffer.alloc(64 * 1024);
    const chunkCount = Math.ceil(MAX_MOD_FILE_BYTES / chunk.byteLength) + 1;
    async function* oversizedStream(): AsyncGenerator<Uint8Array> {
      for (let index = 0; index < chunkCount; index++) {
        yield chunk;
      }
    }
    const request = {
      parts: () =>
        (async function* () {
          yield { type: "file", fieldname: "file", filename: "big.jar", file: oversizedStream() };
        })(),
    } as unknown as FastifyRequest;

    await expect(parseModsUploadRequest(request)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(readdirSync(UPLOAD_TMP_DIR)).toEqual([]);
  });

  it("усечённый файл отклоняется как 413 и temp чистится", async (): Promise<void> => {
    mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
    const truncatedFile = Object.assign(Readable.from([Buffer.from("bytes")]), { truncated: true });
    const request = buildFakeRequest([
      { type: "file", fieldname: "file", filename: "big.jar", file: truncatedFile },
    ]);

    await expect(parseModsUploadRequest(request)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(readdirSync(UPLOAD_TMP_DIR)).toEqual([]);
  });
});
