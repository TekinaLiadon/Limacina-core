import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import type { MultipartFile } from "@fastify/multipart";
import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { UPLOAD_TMP_DIR, findUpdaterPlatform, matchUpdaterArtifactSuffix } from "./launcher-files";
import { FileTooLargeError, removeFile, streamPartToFile } from "../utils/multipart-file";
import type { UpdaterArtifactUpload } from "./release-publish.service";

const SIGNATURE_FIELD_SUFFIX = "_sig";

export const MAX_RELEASE_ARTIFACT_BYTES = 1024 * 1024 * 1024;
const MAX_RELEASE_SIGNATURE_BYTES = 64 * 1024;

export interface LauncherReleaseRequest {
  version: string;
  artifacts: UpdaterArtifactUpload[];
}

export async function parseLauncherReleaseRequest(
  request: FastifyRequest,
): Promise<LauncherReleaseRequest> {
  const staged: string[] = [];
  try {
    let version = "";
    const artifacts = new Map<
      string,
      { suffix: string; artifactTempPath?: string; signatureTempPath?: string }
    >();

    for await (const part of request.parts({ limits: { fileSize: MAX_RELEASE_ARTIFACT_BYTES } })) {
      if (part.type === "field") {
        if (part.fieldname !== "version") continue;
        if (typeof part.value !== "string") {
          throw new BadRequestException("Поле version должно быть строкой");
        }
        version = part.value;
        continue;
      }

      const isSignature = part.fieldname.endsWith(SIGNATURE_FIELD_SUFFIX);
      const platformKey = isSignature
        ? part.fieldname.slice(0, part.fieldname.length - SIGNATURE_FIELD_SUFFIX.length)
        : part.fieldname;
      const platform = findUpdaterPlatform(platformKey);
      if (!platform) {
        throw new BadRequestException(
          `Неизвестное файловое поле: ${part.fieldname}. Ожидаются поля вида <платформа> и <платформа>_sig`,
        );
      }

      const entry = artifacts.get(platformKey) ?? { suffix: "" };
      if (isSignature) {
        if (entry.signatureTempPath) {
          throw new BadRequestException(`Повторное поле подписи: ${part.fieldname}`);
        }
        entry.signatureTempPath = await stagePart(
          part,
          `${platformKey}.sig`,
          staged,
          MAX_RELEASE_SIGNATURE_BYTES,
        );
      } else {
        if (entry.artifactTempPath) {
          throw new BadRequestException(`Повторное поле артефакта: ${part.fieldname}`);
        }
        const suffix = matchUpdaterArtifactSuffix(part.filename ?? "", platformKey);
        if (!suffix) {
          throw new BadRequestException(
            `Неподдерживаемое расширение артефакта для ${platformKey}: ожидается ${platform.artifactSuffixes.join(" или ")}`,
          );
        }
        entry.suffix = suffix;
        entry.artifactTempPath = await stagePart(
          part,
          platformKey,
          staged,
          MAX_RELEASE_ARTIFACT_BYTES,
        );
      }
      artifacts.set(platformKey, entry);
    }

    const uploads: UpdaterArtifactUpload[] = [];
    for (const [platformKey, entry] of artifacts) {
      if (!entry.artifactTempPath || !entry.signatureTempPath) {
        throw new BadRequestException(
          `Для платформы ${platformKey} нужны и артефакт, и подпись (поля ${platformKey} и ${platformKey}_sig)`,
        );
      }
      uploads.push({
        platformKey,
        suffix: entry.suffix,
        artifactTempPath: entry.artifactTempPath,
        signatureTempPath: entry.signatureTempPath,
      });
    }

    return { version, artifacts: uploads };
  } catch (error) {
    for (const tempPath of staged) removeFile(tempPath);
    throw error;
  }
}

async function stagePart(
  part: MultipartFile,
  nameSuffix: string,
  staged: string[],
  maxBytes: number,
): Promise<string> {
  const tempPath = join(UPLOAD_TMP_DIR, `${randomUUID()}.${nameSuffix}`);
  staged.push(tempPath);

  try {
    await streamPartToFile(part.file, tempPath, maxBytes);
  } catch (error) {
    if (error instanceof FileTooLargeError) {
      throw new BadRequestException(`Файл ${nameSuffix} превышает лимит ${maxBytes} байт`);
    }
    throw error;
  }
  if (part.file.truncated) {
    throw new PayloadTooLargeException(`Файл ${nameSuffix} превышает лимит ${maxBytes} байт`);
  }
  return tempPath;
}
