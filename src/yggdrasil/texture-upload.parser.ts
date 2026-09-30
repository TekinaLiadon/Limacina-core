import { BadRequestException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { MAX_TEXTURE_BYTES } from "../utils/texture";
import { drainFilePart, readFilePart, streamLimitBytes } from "../utils/multipart-file";

const TEXTURE_STREAM_LIMIT_BYTES = streamLimitBytes(MAX_TEXTURE_BYTES);

export interface YggdrasilTextureUpload {
  model?: string | undefined;
  file: Uint8Array;
}

export async function parseTextureUpload(request: FastifyRequest): Promise<YggdrasilTextureUpload> {
  let model: string | undefined;
  let file: Uint8Array | undefined;

  for await (const part of request.parts()) {
    if (part.type === "field") {
      if (part.fieldname !== "model") continue;
      if (model !== undefined) throw new BadRequestException("Повторное поле: model");
      if (typeof part.value !== "string") {
        throw new BadRequestException("Поле model должно быть строкой");
      }
      model = part.value;
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
    file = await readFilePart(part, TEXTURE_STREAM_LIMIT_BYTES);
  }

  if (file === undefined) throw new BadRequestException("Файл не загружен");
  return { model, file };
}
