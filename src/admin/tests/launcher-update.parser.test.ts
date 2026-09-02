import { describe, expect, it } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { parseLauncherUpdateRequest } from "../launcher-update.parser";

interface FakePart {
  type: "field" | "file";
  fieldname: string;
  value?: string;
  toBuffer?: () => Promise<Buffer>;
}

function buildFakeRequest(parts: FakePart[]): FastifyRequest {
  async function* iterateParts() {
    for (const part of parts) yield part;
  }
  return { parts: () => iterateParts() } as unknown as FastifyRequest;
}

describe("parseLauncherUpdateRequest", (): void => {
  it("читает version и файл macos_arm64", async () => {
    const request = buildFakeRequest([
      { type: "field", fieldname: "version", value: "1.2.3" },
      {
        type: "file",
        fieldname: "macos_arm64",
        toBuffer: () => Promise.resolve(Buffer.from("macos-zip")),
      },
    ]);

    const result = await parseLauncherUpdateRequest(request);

    expect(result.version).toBe("1.2.3");
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.os).toBe("macos");
    expect(result.files[0]?.arch).toBe("arm64");
    expect(result.files[0]?.buffer.toString()).toBe("macos-zip");
  });

  it("отклоняет неизвестное файловое поле", async () => {
    const request = buildFakeRequest([
      {
        type: "file",
        fieldname: "linux_x64",
        toBuffer: () => Promise.resolve(Buffer.from("zip")),
      },
    ]);

    expect(parseLauncherUpdateRequest(request)).rejects.toBeInstanceOf(BadRequestException);
  });
});
