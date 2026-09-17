import { mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

export class FileTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Файл превышает лимит ${maxBytes} байт`);
    this.name = "FileTooLargeError";
  }
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
    removeFile(tempPath);
    throw error;
  }
}

export function removeFile(tempPath: string): void {
  try {
    unlinkSync(tempPath);
  } catch {
    return;
  }
}
