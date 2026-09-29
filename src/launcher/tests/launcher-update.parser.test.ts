import { UPLOAD_TMP_DIR, MULTIPART_FILE_SIZE_LIMIT_BYTES } from "../launcher-files";
import { afterEach, describe, expect, it } from "bun:test";
import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import type { FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import { parseLauncherUpdateRequest } from "../launcher-update.parser";
import type { LauncherPlatformFile } from "../launcher-update.service";

interface FakePart {
  type: "field" | "file";
  fieldname: string;
  value?: string;
  file?: NodeJS.ReadableStream;
}

function buildFakeRequest(parts: FakePart[]): FastifyRequest {
  async function* iterateParts() {
    for (const part of parts) yield part;
  }
  return { parts: (_options?: unknown) => iterateParts() } as unknown as FastifyRequest;
}

function buildCapturingFakeRequest(parts: FakePart[]): {
  request: FastifyRequest;
  capturedOptions: () => unknown;
} {
  let captured: unknown;
  async function* iterateParts() {
    for (const part of parts) yield part;
  }
  const request = {
    parts: (options?: unknown) => {
      captured = options;
      return iterateParts();
    },
  } as unknown as FastifyRequest;
  return { request, capturedOptions: () => captured };
}

function filePart(fieldname: string, content: string): FakePart {
  return { type: "file", fieldname, file: Readable.from([Buffer.from(content)]) };
}

describe("parseLauncherUpdateRequest (TASK-20: стриминг в temp-файл)", (): void => {
  afterEach((): void => {
    if (existsSync(UPLOAD_TMP_DIR)) {
      rmSync(UPLOAD_TMP_DIR, { recursive: true, force: true });
    }
  });

  it("стримит файл в temp и возвращает платформу с путём", async () => {
    const request = buildFakeRequest([
      { type: "field", fieldname: "version", value: "1.2.3" },
      filePart("macos_arm64", "macos-zip"),
    ]);

    const result = await parseLauncherUpdateRequest(request);

    expect(result.version).toBe("1.2.3");
    expect(result.files).toHaveLength(1);
    const file = result.files[0] as LauncherPlatformFile;
    expect(file.os).toBe("macos");
    expect(file.arch).toBe("arm64");
    expect(file.tempPath).toContain(UPLOAD_TMP_DIR);
    expect(readFileSync(file.tempPath, "utf-8")).toBe("macos-zip");
  });

  it("возвращает несколько платформ в порядке следования частей", async () => {
    const request = buildFakeRequest([
      filePart("linux_x86_64", "linux-zip"),
      { type: "field", fieldname: "version", value: "2.0.0" },
      filePart("windows_x86_64", "windows-zip"),
    ]);

    const result = await parseLauncherUpdateRequest(request);

    expect(result.version).toBe("2.0.0");
    expect(result.files.map((f) => `${f.os}/${f.arch}`)).toEqual([
      "linux/x86_64",
      "windows/x86_64",
    ]);
    expect(readFileSync(result.files[0]!.tempPath, "utf-8")).toBe("linux-zip");
    expect(readFileSync(result.files[1]!.tempPath, "utf-8")).toBe("windows-zip");
  });

  it("отклоняет неизвестное файловое поле и подчищает уже записанные temp", async () => {
    mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
    const request = buildFakeRequest([
      filePart("linux_x86_64", "zip"),
      filePart("linux_x64", "zip"),
    ]);

    await expect(parseLauncherUpdateRequest(request)).rejects.toBeInstanceOf(BadRequestException);

    expect(readdirSync(UPLOAD_TMP_DIR)).toEqual([]);
  });

  it("отклоняет повторное файловое поле платформы и подчищает temp", async () => {
    mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
    const request = buildFakeRequest([
      filePart("linux_x86_64", "first-zip"),
      filePart("linux_x86_64", "second-zip"),
    ]);

    await expect(parseLauncherUpdateRequest(request)).rejects.toThrow(
      "Повторное файловое поле: linux_x86_64",
    );

    expect(readdirSync(UPLOAD_TMP_DIR)).toEqual([]);
  });

  it("передаёт плагину multipart явный лимит размера части (TASK-411.6)", async () => {
    const { request, capturedOptions } = buildCapturingFakeRequest([]);

    await parseLauncherUpdateRequest(request);

    expect(capturedOptions()).toEqual({ limits: { fileSize: MULTIPART_FILE_SIZE_LIMIT_BYTES } });
  });

  it("усечённая busboy-часть (truncated) отклоняется как 413, temp подчищен (TASK-411.6)", async () => {
    mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
    const truncatedFile = Object.assign(Readable.from([Buffer.from("truncated-zip")]), {
      truncated: true,
    });
    const request = buildFakeRequest([
      { type: "field", fieldname: "version", value: "1.2.3" },
      { type: "file", fieldname: "linux_x86_64", file: truncatedFile },
    ]);

    const error = await parseLauncherUpdateRequest(request).then(
      (): BadRequestException | undefined => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(PayloadTooLargeException);
    expect((error as PayloadTooLargeException).getStatus()).toBe(413);
    expect(readdirSync(UPLOAD_TMP_DIR)).toEqual([]);
  });

  it("обрыв итератора частей (лимит плагина) подчищает уже записанные temp (TASK-411.6)", async () => {
    mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
    const limitError = Object.assign(new Error("request file too large"), {
      statusCode: 413,
      code: "FST_REQ_FILE_TOO_LARGE",
    });
    async function* iterateParts() {
      yield filePart("linux_x86_64", "zip");
      throw limitError;
    }
    const request = { parts: () => iterateParts() } as unknown as FastifyRequest;

    await expect(parseLauncherUpdateRequest(request)).rejects.toBe(limitError);

    expect(readdirSync(UPLOAD_TMP_DIR)).toEqual([]);
  });
});
