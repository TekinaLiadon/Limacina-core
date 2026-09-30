import { mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { PayloadTooLargeException } from "@nestjs/common";
import type { MultipartFile } from "@fastify/multipart";
import { concatBytes } from "./bytes";

export const STREAM_LIMIT_MULTIPLIER = 2;

export function streamLimitBytes(maxBytes: number): number {
  return maxBytes * STREAM_LIMIT_MULTIPLIER;
}

export class FileTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Файл превышает лимит ${maxBytes} байт`);
    this.name = "FileTooLargeError";
  }
}

export async function drainFilePart(part: MultipartFile): Promise<void> {
  for await (const chunk of part.file) {
    void chunk;
  }
}

export async function readFilePart(part: MultipartFile, maxBytes: number): Promise<Uint8Array> {
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
  return concatBytes(chunks);
}

export async function streamPartToFile(
  stream: AsyncIterable<Uint8Array>,
  tempPath: string,
  maxBytes?: number,
): Promise<void> {
  mkdirSync(dirname(tempPath), { recursive: true });
  const writer = Bun.file(tempPath).writer();
  let written = 0;
  try {
    for await (const chunk of stream) {
      written += chunk.byteLength;
      if (maxBytes !== undefined && written > maxBytes) {
        throw new FileTooLargeError(maxBytes);
      }
      writer.write(chunk);
    }
    await writer.end();
  } catch (error) {
    await closeWriterQuietly(writer);
    removeFile(tempPath);
    throw error;
  }
}

async function closeWriterQuietly(writer: Bun.FileSink): Promise<void> {
  try {
    await writer.end();
  } catch {
    return;
  }
}

export function removeFile(tempPath: string): void {
  try {
    unlinkSync(tempPath);
  } catch {
    return;
  }
}
