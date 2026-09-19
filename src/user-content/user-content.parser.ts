import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import { MAX_TEXTURE_BYTES } from "../utils/texture";
import { MAX_MODEL_BYTES } from "./user-content.service";

const STREAM_LIMIT_MULTIPLIER = 2;
export const TEXTURE_UPLOAD_LIMIT_BYTES = MAX_TEXTURE_BYTES * STREAM_LIMIT_MULTIPLIER;
export const MODEL_UPLOAD_LIMIT_BYTES = MAX_MODEL_BYTES * STREAM_LIMIT_MULTIPLIER;

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    merged.set(chunk, cursor);
    cursor += chunk.length;
  }
  return merged;
}

async function drainFilePart(part: MultipartFile): Promise<void> {
  for await (const chunk of part.file) {
    void chunk;
  }
}

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

async function readFilePart(part: MultipartFile, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let received = 0;
  for await (const chunk of part.file) {
    received += chunk.length;
    if (received > maxBytes) {
      throw new PayloadTooLargeException(`Файл слишком большой: максимум ${maxBytes} байт`);
    }
    chunks.push(chunk);
  }
  if (part.file.truncated) {
    throw new PayloadTooLargeException(`Файл слишком большой: максимум ${maxBytes} байт`);
  }
  return concatChunks(chunks, received);
}
