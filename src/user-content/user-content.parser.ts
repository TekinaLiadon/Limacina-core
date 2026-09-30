import { BadRequestException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { MAX_TEXTURE_BYTES } from "../utils/texture";
import { MAX_MODEL_BYTES } from "./user-content.service";
import { drainFilePart, readFilePart, streamLimitBytes } from "../utils/multipart-file";

export const TEXTURE_UPLOAD_LIMIT_BYTES = streamLimitBytes(MAX_TEXTURE_BYTES);
export const MODEL_UPLOAD_LIMIT_BYTES = streamLimitBytes(MAX_MODEL_BYTES);

export async function parseContentUpload(
  request: FastifyRequest,
  maxBytes: number,
): Promise<Uint8Array> {
  const parts = request.parts({ limits: { fileSize: maxBytes } });
  let file: Uint8Array | undefined;
  for await (const part of parts) {
    if (part.type !== "file") continue;
    if (file !== undefined) {
      await drainFilePart(part);
      throw new BadRequestException("Ожидается ровно один файл");
    }
    file = await readFilePart(part, maxBytes);
  }
  if (file === undefined) {
    throw new BadRequestException("Файл не загружен");
  }
  return file;
}
