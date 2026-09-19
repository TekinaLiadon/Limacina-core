import { describe, expect, it } from "bun:test";
import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import { parseContentUpload } from "../user-content.parser";

function filePart(data: Uint8Array[], truncated = false): MultipartFile {
  async function* file(): AsyncIterable<Uint8Array> {
    for (const chunk of data) yield chunk;
  }
  return {
    type: "file",
    fieldname: "file",
    filename: "skin.png",
    file: Object.assign(file(), { truncated }),
  } as unknown as MultipartFile;
}

function fieldPart(fieldname: string, value: string): unknown {
  return { type: "field", fieldname, value };
}

function fakeRequest(parts: unknown[]): FastifyRequest {
  return {
    parts: async function* (): AsyncIterable<unknown> {
      for (const part of parts) yield part;
    },
  } as unknown as FastifyRequest;
}

describe("parseContentUpload", () => {
  it("собирает файл из чанков", async () => {
    const request = fakeRequest([filePart([new Uint8Array([1, 2]), new Uint8Array([3])])]);

    const file = await parseContentUpload(request, 1024);

    expect(file).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("пропускает полевые части", async () => {
    const request = fakeRequest([fieldPart("model", "slim"), filePart([new Uint8Array([9])])]);

    const file = await parseContentUpload(request, 1024);

    expect(file).toEqual(new Uint8Array([9]));
  });

  it("требует хотя бы один файл", async () => {
    const request = fakeRequest([fieldPart("model", "slim")]);

    await expect(parseContentUpload(request, 1024)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("отвергает второй файл", async () => {
    const request = fakeRequest([filePart([new Uint8Array([1])]), filePart([new Uint8Array([2])])]);

    await expect(parseContentUpload(request, 1024)).rejects.toThrow("Ожидается ровно один файл");
  });

  it("отвергает файл больше лимита во время стриминга", async () => {
    const request = fakeRequest([filePart([new Uint8Array(600), new Uint8Array(500)])]);

    await expect(parseContentUpload(request, 1024)).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
  });

  it("отвергает усечённый файл", async () => {
    const request = fakeRequest([filePart([new Uint8Array(16)], true)]);

    await expect(parseContentUpload(request, 1024)).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
  });
});
