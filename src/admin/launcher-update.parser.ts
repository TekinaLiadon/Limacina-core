import { BadRequestException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { mkdirSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { SUPPORTED_PLATFORMS } from "../launcher/launcher-files";
import type { LauncherPlatformFile } from "./launcher-update.service";

const FIELD_PLATFORMS: Record<string, { os: string; arch: string }> = Object.fromEntries(
  Object.entries(SUPPORTED_PLATFORMS).flatMap(([os, archs]) =>
    archs.map((arch) => [`${os}_${arch}`, { os, arch }]),
  ),
);

const UPLOAD_TMP_DIR = join("public", ".upload-tmp");

export interface LauncherUpdateRequest {
  version: string;
  files: LauncherPlatformFile[];
}

export async function parseLauncherUpdateRequest(
  request: FastifyRequest,
): Promise<LauncherUpdateRequest> {
  const staged: string[] = [];
  try {
    let version = "";
    const files: LauncherPlatformFile[] = [];

    for await (const part of request.parts()) {
      if (part.type === "field" && part.fieldname === "version") {
        version = part.value as string;
        continue;
      }

      if (part.type !== "file") continue;

      const platform = FIELD_PLATFORMS[part.fieldname];
      if (!platform) {
        throw new BadRequestException(`Неизвестное файловое поле: ${part.fieldname}`);
      }

      const tempPath = join(UPLOAD_TMP_DIR, `${randomUUID()}.zip`);
      await streamPartToFile(part.file, tempPath);
      staged.push(tempPath);
      files.push({ ...platform, tempPath });
    }

    return { version, files };
  } catch (error) {
    for (const tempPath of staged) removeFile(tempPath);
    throw error;
  }
}

async function streamPartToFile(
  stream: AsyncIterable<Uint8Array>,
  tempPath: string,
): Promise<void> {
  mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
  const writer = Bun.file(tempPath).writer();
  try {
    for await (const chunk of stream) {
      writer.write(chunk);
    }
    await writer.end();
  } catch (error) {
    removeFile(tempPath);
    throw error;
  }
}

function removeFile(tempPath: string): void {
  try {
    unlinkSync(tempPath);
  } catch {
    return;
  }
}
