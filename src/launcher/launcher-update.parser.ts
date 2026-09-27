import { BadRequestException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { SUPPORTED_PLATFORMS, UPLOAD_TMP_DIR } from "./launcher-files";
import { removeFile, streamPartToFile } from "../utils/multipart-file";
import type { LauncherPlatformFile } from "./launcher-update.service";

const FIELD_PLATFORMS: Record<string, { os: string; arch: string }> = Object.fromEntries(
  Object.entries(SUPPORTED_PLATFORMS).flatMap(([os, archs]) =>
    archs.map((arch) => [`${os}_${arch}`, { os, arch }]),
  ),
);

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
    const seenFields = new Set<string>();

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

      if (seenFields.has(part.fieldname)) {
        throw new BadRequestException(`Повторное файловое поле: ${part.fieldname}`);
      }
      seenFields.add(part.fieldname);

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
