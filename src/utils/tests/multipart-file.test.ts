import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileTooLargeError, removeFile, streamPartToFile } from "../multipart-file";

const tmpRoot = join(tmpdir(), "limacina-multipart-tests");

async function* chunks(parts: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const part of parts) yield part;
}

describe("multipart-file", () => {
  beforeEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("streamPartToFile записывает содержимое и создаёт вложенный каталог", async () => {
    const tempPath = join(tmpRoot, "nested", "file.zip");

    await streamPartToFile(chunks([new Uint8Array([1, 2, 3]), new Uint8Array([4])]), tempPath);

    expect(existsSync(tempPath)).toBe(true);
    expect(await Bun.file(tempPath).arrayBuffer()).toEqual(new Uint8Array([1, 2, 3, 4]).buffer);
  });

  it("streamPartToFile без maxBytes принимает любой размер", async () => {
    const tempPath = join(tmpRoot, "big.zip");

    await streamPartToFile(chunks([new Uint8Array(1024)]), tempPath);

    expect((await Bun.file(tempPath).arrayBuffer()).byteLength).toBe(1024);
  });

  it("streamPartToFile выбрасывает FileTooLargeError сверх лимита и удаляет файл", async () => {
    const tempPath = join(tmpRoot, "limited.zip");

    await expect(
      streamPartToFile(chunks([new Uint8Array(600), new Uint8Array(500)]), tempPath, 1024),
    ).rejects.toBeInstanceOf(FileTooLargeError);

    expect(existsSync(tempPath)).toBe(false);
  });

  it("streamPartToFile удаляет файл при ошибке записи", async () => {
    const tempPath = join(tmpRoot, "failed.zip");
    mkdirSync(tmpRoot, { recursive: true });

    async function* failing(): AsyncIterable<Uint8Array> {
      yield new Uint8Array([1]);
      throw new Error("stream broken");
    }

    await expect(streamPartToFile(failing(), tempPath)).rejects.toThrow("stream broken");
    expect(existsSync(tempPath)).toBe(false);
  });

  it("streamPartToFile закрывает writer (Bun FileSink) на error-пути", async () => {
    const tempPath = join(tmpRoot, "leaked.zip");
    mkdirSync(tmpRoot, { recursive: true });
    let endCalls = 0;
    const fakeSink = {
      write: (): void => {},
      end: async (): Promise<void> => {
        endCalls++;
      },
    };
    const bunFileSpy = spyOn(Bun, "file").mockImplementation(
      () =>
        ({
          writer: () => fakeSink,
        }) as unknown as ReturnType<typeof Bun.file>,
    );

    async function* failing(): AsyncIterable<Uint8Array> {
      yield new Uint8Array([1]);
      throw new Error("stream broken");
    }

    try {
      await expect(streamPartToFile(failing(), tempPath)).rejects.toThrow("stream broken");
    } finally {
      bunFileSpy.mockRestore();
    }

    expect(endCalls).toBe(1);
    expect(existsSync(tempPath)).toBe(false);
  });

  it("removeFile молчит на отсутствующем файле", () => {
    expect(() => removeFile(join(tmpRoot, "nothing.zip"))).not.toThrow();
  });

  it("removeFile удаляет существующий файл", async () => {
    const tempPath = join(tmpRoot, "removable.zip");
    mkdirSync(tmpRoot, { recursive: true });
    await Bun.write(tempPath, "data");

    removeFile(tempPath);

    expect(existsSync(tempPath)).toBe(false);
  });
});
