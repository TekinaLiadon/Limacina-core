import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import type { MultipartFile } from "@fastify/multipart";
import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { MULTIPART_FILE_SIZE_LIMIT_BYTES, UPLOAD_TMP_DIR } from "../launcher/launcher-files";
import { FileTooLargeError, removeFile, streamPartToFile } from "../utils/multipart-file";

export const MAX_MOD_FILE_BYTES = MULTIPART_FILE_SIZE_LIMIT_BYTES;

const MOD_FILE_EXTENSION = ".jar";
const MAX_MOD_NAME_BYTES = 255;
const MISSING_NAME_MESSAGE = "Файл мода без имени";
const INVALID_NAME_MESSAGE = "Недопустимое имя файла мода";
const EMPTY_UPLOAD_MESSAGE = "Нужен хотя бы один файл мода";

export interface StagedModUpload {
  name: string;
  tempPath: string;
}

export function normalizeModEntryName(rawName: string | undefined): string {
  const name = rawName?.trim() ?? "";
  if (!name) {
    throw new BadRequestException(MISSING_NAME_MESSAGE);
  }
  if (
    name !== basename(name) ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.startsWith(".")
  ) {
    throw new BadRequestException(`${INVALID_NAME_MESSAGE}: ${name}`);
  }
  if (Buffer.byteLength(name, "utf8") > MAX_MOD_NAME_BYTES) {
    throw new BadRequestException(`Имя файла мода длиннее ${MAX_MOD_NAME_BYTES} байт`);
  }
  return name;
}

export function normalizeModUploadName(rawName: string | undefined): string {
  const name = normalizeModEntryName(rawName);
  if (!name.toLowerCase().endsWith(MOD_FILE_EXTENSION)) {
    throw new BadRequestException(`Мод должен быть файлом ${MOD_FILE_EXTENSION}`);
  }
  return name;
}

export async function parseModsUploadRequest(request: FastifyRequest): Promise<StagedModUpload[]> {
  const staged: StagedModUpload[] = [];
  try {
    for await (const part of request.parts({ limits: { fileSize: MAX_MOD_FILE_BYTES } })) {
      if (part.type === "field") continue;
      staged.push(await stageModPart(part, staged));
    }

    if (staged.length === 0) {
      throw new BadRequestException(EMPTY_UPLOAD_MESSAGE);
    }
    return staged;
  } catch (error) {
    removeStagedMods(staged);
    throw error;
  }
}

async function stageModPart(
  part: MultipartFile,
  staged: StagedModUpload[],
): Promise<StagedModUpload> {
  const name = normalizeModUploadName(part.filename);
  if (staged.some((upload) => upload.name.toLowerCase() === name.toLowerCase())) {
    throw new BadRequestException(`Повторное имя файла мода: ${name}`);
  }

  const tempPath = join(UPLOAD_TMP_DIR, `${randomUUID()}.part`);
  try {
    await streamPartToFile(part.file, tempPath, MAX_MOD_FILE_BYTES);
  } catch (error) {
    if (error instanceof FileTooLargeError) {
      throw new PayloadTooLargeException(`Файл ${name} превышает лимит ${MAX_MOD_FILE_BYTES} байт`);
    }
    throw error;
  }

  if (part.file.truncated) {
    removeFile(tempPath);
    throw new PayloadTooLargeException(`Файл ${name} превышает лимит ${MAX_MOD_FILE_BYTES} байт`);
  }
  return { name, tempPath };
}

function removeStagedMods(staged: StagedModUpload[]): void {
  for (const upload of staged) {
    removeFile(upload.tempPath);
  }
}
