import { BadRequestException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { SUPPORTED_PLATFORMS } from "../launcher/launcher-files";
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

    const buffer = await part.toBuffer();
    files.push({ ...platform, buffer });
  }

  return { version, files };
}
