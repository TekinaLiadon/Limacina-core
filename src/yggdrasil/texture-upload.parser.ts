import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import { MAX_TEXTURE_BYTES } from "../utils/texture";

const STREAM_LIMIT_MULTIPLIER = 2;
const TEXTURE_STREAM_LIMIT_BYTES = MAX_TEXTURE_BYTES * STREAM_LIMIT_MULTIPLIER;

export interface YggdrasilTextureUpload {
  model?: string | undefined;
  file: Uint8Array;
}

async function drainFilePart(part: MultipartFile): Promise<void> {
  for await (const chunk of part.file) {
    void chunk;
  }
}

async function readFilePart(part: MultipartFile): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let received = 0;
  for await (const chunk of part.file) {
    received += chunk.length;
    if (received > TEXTURE_STREAM_LIMIT_BYTES) {
      throw new PayloadTooLargeException(
        `Файл слишком большой: максимум ${TEXTURE_STREAM_LIMIT_BYTES} байт`,
      );
    }
    chunks.push(chunk);
  }
  if (part.file.truncated) {
    throw new PayloadTooLargeException(
      `Файл слишком большой: максимум ${TEXTURE_STREAM_LIMIT_BYTES} байт`,
    );
  }

  const merged = new Uint8Array(received);
  let cursor = 0;
  for (const chunk of chunks) {
    merged.set(chunk, cursor);
    cursor += chunk.length;
  }
  return merged;
}

export async function parseTextureUpload(request: FastifyRequest): Promise<YggdrasilTextureUpload> {
  let model: string | undefined;
  let file: Uint8Array | undefined;

  for await (const part of request.parts()) {
    if (part.type === "field") {
      if (part.fieldname !== "model") continue;
      if (model !== undefined) throw new BadRequestException("Повторное поле: model");
      model = part.value as string;
      continue;
    }

    if (part.fieldname !== "file") {
      await drainFilePart(part);
      throw new BadRequestException(`Неизвестное файловое поле: ${part.fieldname}`);
    }
    if (file !== undefined) {
      await drainFilePart(part);
      throw new BadRequestException("Ожидается ровно один файл");
    }
    file = await readFilePart(part);
  }

  if (file === undefined) throw new BadRequestException("Файл не загружен");
  return { model, file };
}
