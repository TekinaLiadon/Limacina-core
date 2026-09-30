import { UPLOAD_TMP_DIR } from "../launcher-files";
import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { afterEach, describe, expect, it } from "bun:test";
import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import type { FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import { MAX_RELEASE_ARTIFACT_BYTES, parseLauncherReleaseRequest } from "../release-publish.parser";

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

describe("parseLauncherReleaseRequest (стриминг артефактов и подписей в temp)", (): void => {
  it("читает version, артефакт и подпись, определяя суффикс по имени файла", async () => {
    const request = buildFakeRequest([
      { type: "field", fieldname: "version", value: "1.2.3" },
      filePart("windows-x86_64", "MyApp_1.2.3_x64-setup.exe", "installer-bytes"),
      filePart("windows-x86_64_sig", "MyApp_1.2.3_x64-setup.exe.sig", "sig-bytes"),
    ]);

    const result = await parseLauncherReleaseRequest(request);

    expect(result.version).toBe("1.2.3");
    expect(result.artifacts).toHaveLength(1);
    const artifact = result.artifacts[0]!;
    expect(artifact.platformKey).toBe("windows-x86_64");
    expect(artifact.suffix).toBe(".exe");
    expect(readFileSync(artifact.artifactTempPath, "utf-8")).toBe("installer-bytes");
    expect(readFileSync(artifact.signatureTempPath, "utf-8")).toBe("sig-bytes");
  });

  it("принимает части в любом порядке и несколько платформ", async () => {
    const request = buildFakeRequest([
      filePart("windows-x86_64_sig", "sig.exe.sig", "sig-windows"),
      filePart("darwin-aarch64", "app.app.tar.gz", "macos-bytes"),
      { type: "field", fieldname: "version", value: "2.0.0" },
      filePart("windows-x86_64", "setup.exe", "windows-bytes"),
      filePart("darwin-aarch64_sig", "app.sig", "sig-macos"),
    ]);

    const result = await parseLauncherReleaseRequest(request);

    expect(result.version).toBe("2.0.0");
    expect(result.artifacts.map((artifact) => artifact.platformKey)).toEqual([
      "windows-x86_64",
      "darwin-aarch64",
    ]);
    expect(result.artifacts[0]!.suffix).toBe(".exe");
    expect(result.artifacts[1]!.suffix).toBe(".app.tar.gz");
  });

  it("отклоняет неизвестное файловое поле и подчищает уже записанные temp", async () => {
    mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
    const request = buildFakeRequest([
      filePart("windows-x86_64", "setup.exe", "bytes"),
      filePart("linux_x64", "app.AppImage", "bytes"),
    ]);

    await expect(parseLauncherReleaseRequest(request)).rejects.toBeInstanceOf(BadRequestException);
    expect(readdirSync(UPLOAD_TMP_DIR)).toEqual([]);
  });

  it("отклоняет артефакт с неподдерживаемым расширением", async () => {
    const request = buildFakeRequest([
      filePart("windows-x86_64", "setup.msi", "bytes"),
      filePart("windows-x86_64_sig", "setup.exe.sig", "sig"),
    ]);

    await expect(parseLauncherReleaseRequest(request)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("отклоняет артефакт без имени файла", async () => {
    const request = buildFakeRequest([
      { type: "file", fieldname: "windows-x86_64", file: Readable.from([Buffer.from("b")]) },
      filePart("windows-x86_64_sig", "setup.exe.sig", "sig"),
    ]);

    await expect(parseLauncherReleaseRequest(request)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("отклоняет неполную пару: артефакт без подписи", async () => {
    const request = buildFakeRequest([
      { type: "field", fieldname: "version", value: "1.2.3" },
      filePart("windows-x86_64", "setup.exe", "bytes"),
    ]);

    await expect(parseLauncherReleaseRequest(request)).rejects.toThrow("и артефакт, и подпись");
  });

  it("отклоняет неполную пару: подпись без артефакта", async () => {
    const request = buildFakeRequest([
      { type: "field", fieldname: "version", value: "1.2.3" },
      filePart("linux-x86_64_sig", "app.AppImage.sig", "sig"),
    ]);

    await expect(parseLauncherReleaseRequest(request)).rejects.toThrow("linux-x86_64");
  });

  it("отклоняет повторное поле артефакта", async () => {
    const request = buildFakeRequest([
      filePart("windows-x86_64", "setup.exe", "bytes"),
      filePart("windows-x86_64", "setup2.exe", "bytes"),
      filePart("windows-x86_64_sig", "setup.exe.sig", "sig"),
    ]);

    await expect(parseLauncherReleaseRequest(request)).rejects.toThrow("Повторное поле артефакта");
  });

  it("отклоняет повторное поле подписи", async () => {
    const request = buildFakeRequest([
      filePart("windows-x86_64", "setup.exe", "bytes"),
      filePart("windows-x86_64_sig", "a.sig", "sig-one"),
      filePart("windows-x86_64_sig", "b.sig", "sig-two"),
    ]);

    await expect(parseLauncherReleaseRequest(request)).rejects.toThrow("Повторное поле подписи");
  });

  it("отклоняет подпись больше лимита", async () => {
    const oversized = "x".repeat(64 * 1024 + 1);
    const request = buildFakeRequest([
      filePart("windows-x86_64", "setup.exe", "bytes"),
      filePart("windows-x86_64_sig", "setup.exe.sig", oversized),
    ]);

    await expect(parseLauncherReleaseRequest(request)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("передаёт плагину multipart лимит размера артефакта", async () => {
    let capturedOptions: unknown;
    const request = {
      parts: (options?: unknown) => {
        capturedOptions = options;
        return (async function* () {})();
      },
    } as unknown as FastifyRequest;

    await parseLauncherReleaseRequest(request);

    expect(capturedOptions).toEqual({ limits: { fileSize: MAX_RELEASE_ARTIFACT_BYTES } });
  });

  it("усечённый артефакт (busboy обрезал ровно на лимите) отклоняется как 413", async () => {
    mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
    const truncatedFile = Object.assign(Readable.from([Buffer.from("installer-bytes")]), {
      truncated: true,
    });
    const request = buildFakeRequest([
      { type: "field", fieldname: "version", value: "1.2.3" },
      { type: "file", fieldname: "windows-x86_64", filename: "setup.exe", file: truncatedFile },
      filePart("windows-x86_64_sig", "setup.exe.sig", "sig-bytes"),
    ]);

    const error = await parseLauncherReleaseRequest(request).then(
      (): BadRequestException | undefined => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(PayloadTooLargeException);
    expect((error as PayloadTooLargeException).getStatus()).toBe(413);
    expect(readdirSync(UPLOAD_TMP_DIR)).toEqual([]);
  });
});
