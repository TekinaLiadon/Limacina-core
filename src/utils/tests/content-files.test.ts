import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import {
  buildContentLocation,
  releaseContentFile,
  resolvePublicContentPath,
} from "../content-files";

const BASE_URL = "http://localhost:3005";
const logger = new Logger("content-files-test");

describe("buildContentLocation", () => {
  it("строит content-addressed имя, url и путь (TASK-269.24)", () => {
    const location = buildContentLocation(
      BASE_URL,
      "textures",
      "steve",
      Buffer.from("png-bytes"),
      "png",
    );

    expect(location.filename).toMatch(/^steve-[0-9a-f]{64}\.png$/);
    expect(location.url).toBe(`${BASE_URL}/textures/${location.filename}`);
    expect(location.path).toBe(`public/textures/${location.filename}`);
  });

  it("одно содержимое даёт одно имя, разное содержимое — разные имена", () => {
    const first = buildContentLocation(BASE_URL, "capes", "alex", Buffer.from("a"), "png");
    const again = buildContentLocation(BASE_URL, "capes", "alex", Buffer.from("a"), "png");
    const other = buildContentLocation(BASE_URL, "capes", "alex", Buffer.from("b"), "png");

    expect(again.filename).toBe(first.filename);
    expect(other.filename).not.toBe(first.filename);
  });

  it("каталог и расширение подставляются (models)", () => {
    const location = buildContentLocation(BASE_URL, "models", "steve", Buffer.from("model"), "txt");

    expect(location.filename).toMatch(/\.txt$/);
    expect(location.path).toBe(`public/models/${location.filename}`);
  });
});

describe("resolvePublicContentPath", () => {
  const DIRECTORIES = ["textures", "capes", "models"];

  it("резолвит url своего каталога в локальный путь", () => {
    expect(resolvePublicContentPath(BASE_URL, `${BASE_URL}/textures/a-b.png`, DIRECTORIES)).toBe(
      "public/textures/a-b.png",
    );
    expect(resolvePublicContentPath(BASE_URL, `${BASE_URL}/models/m-abc.txt`, DIRECTORIES)).toBe(
      "public/models/m-abc.txt",
    );
  });

  it("отклоняет чужой base URL", () => {
    expect(
      resolvePublicContentPath(BASE_URL, "https://evil.test/textures/a.png", DIRECTORIES),
    ).toBeUndefined();
  });

  it("отклоняет каталог вне списка", () => {
    expect(
      resolvePublicContentPath(BASE_URL, `${BASE_URL}/launcher/file.zip`, DIRECTORIES),
    ).toBeUndefined();
  });

  it("отклоняет подъём по каталогам и пустые сегменты", () => {
    expect(
      resolvePublicContentPath(BASE_URL, `${BASE_URL}/textures/../../etc/passwd`, DIRECTORIES),
    ).toBeUndefined();
    expect(
      resolvePublicContentPath(BASE_URL, `${BASE_URL}/textures/../capes/a.png`, DIRECTORIES),
    ).toBeUndefined();
    expect(
      resolvePublicContentPath(BASE_URL, `${BASE_URL}/textures/`, DIRECTORIES),
    ).toBeUndefined();
  });
});

describe("releaseContentFile", () => {
  async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
    const previous = process.cwd();
    process.chdir(dir);
    try {
      return await fn();
    } finally {
      process.chdir(previous);
    }
  }

  function makeTempPublicFile(): { dir: string; filePath: string; url: string } {
    const dir = mkdtempSync(join(tmpdir(), "limacina-content-"));
    mkdirSync(join(dir, "public", "textures"), { recursive: true });
    const filePath = join(dir, "public", "textures", "steve-hash.png");
    writeFileSync(filePath, "texture-data");
    return { dir, filePath, url: `${BASE_URL}/textures/steve-hash.png` };
  }

  it("удаляет файл, когда ссылок не осталось (TASK-269.24)", async () => {
    const { dir, filePath, url } = makeTempPublicFile();
    try {
      await withCwd(dir, () =>
        releaseContentFile({
          logger,
          baseUrl: BASE_URL,
          url,
          directories: ["textures"],
          referenceCount: 0,
        }),
      );

      expect(existsSync(filePath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("оставляет файл при живых ссылках", async () => {
    const { dir, filePath, url } = makeTempPublicFile();
    try {
      const released = await withCwd(dir, () =>
        releaseContentFile({
          logger,
          baseUrl: BASE_URL,
          url,
          directories: ["textures"],
          referenceCount: 2,
        }),
      );

      expect(released).toBe(false);
      expect(existsSync(filePath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("возвращает false для отсутствующего файла, не падая", async () => {
    const dir = mkdtempSync(join(tmpdir(), "limacina-content-"));
    try {
      const released = await withCwd(dir, () =>
        releaseContentFile({
          logger,
          baseUrl: BASE_URL,
          url: `${BASE_URL}/textures/missing.png`,
          directories: ["textures"],
          referenceCount: 0,
        }),
      );

      expect(released).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("не трогает файловую систему для чужого url", async () => {
    const { dir, filePath } = makeTempPublicFile();
    try {
      const released = await withCwd(dir, () =>
        releaseContentFile({
          logger,
          baseUrl: BASE_URL,
          url: "https://evil.test/textures/steve-hash.png",
          directories: ["textures"],
          referenceCount: 0,
        }),
      );

      expect(released).toBe(false);
      expect(existsSync(filePath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
