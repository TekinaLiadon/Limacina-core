import { deflateSync } from "node:zlib";
import { crc32 } from "../png";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const TEST_PNG_SIGNATURE = PNG_SIGNATURE;
const IHDR_CHUNK_BYTES = 25;
const IDAT_CHUNK_OVERHEAD = 12;
const IEND_CHUNK_BYTES = 12;

export interface TestPngOptions {
  width?: number;
  height?: number;
  variant?: number;
  totalBytes?: number;
}

export function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk, 4, 8 + data.length), 8 + data.length);
  return chunk;
}

export function buildTestPng(options: TestPngOptions = {}): Buffer {
  const width = options.width ?? 64;
  const height = options.height ?? 64;
  const variant = options.variant ?? 0;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  if (options.totalBytes !== undefined) {
    const idatLength =
      options.totalBytes -
      PNG_SIGNATURE.length -
      IHDR_CHUNK_BYTES -
      IDAT_CHUNK_OVERHEAD -
      IEND_CHUNK_BYTES;
    if (idatLength < 0) {
      throw new Error(`totalBytes ${options.totalBytes} меньше минимальной структуры PNG`);
    }
    return Buffer.concat([
      PNG_SIGNATURE,
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", Buffer.alloc(idatLength, variant & 0xff)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
  }

  const row = Buffer.alloc(1 + width * 4);
  row[8] = variant & 0xff;
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
