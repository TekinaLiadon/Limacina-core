import { afterEach, describe, expect, it } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import type { FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import { parseLauncherUpdateRequest } from "../launcher-update.parser";
import type { LauncherPlatformFile } from "../launcher-update.service";

const UPLOAD_TMP_DIR = "public/.upload-tmp";

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
  return { parts: () => iterateParts() } as unknown as FastifyRequest;
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
});
