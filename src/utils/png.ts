const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_DATA_LENGTH = 13;
const PNG_CHUNK_HEADER_BYTES = 8;
const PNG_BIT_DEPTHS = [1, 2, 4, 8, 16];
const PNG_COLOR_TYPES = [0, 2, 3, 4, 6];

export const MAX_PNG_DIMENSION = 1024;

export class PngStructureError extends Error {}

const CRC32_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

export function crc32(data: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readUint32(data: Uint8Array, at: number): number {
  return ((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!) >>> 0;
}

function chunkType(data: Uint8Array, at: number): string | undefined {
  let type = "";
  for (let i = 0; i < 4; i++) {
    const byte = data[at + i]!;
    const isLetter = (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122);
    if (!isLetter) return undefined;
    type += String.fromCharCode(byte);
  }
  return type;
}

function validateIhdr(data: Uint8Array, at: number, maxDimension: number): void {
  const width = readUint32(data, at);
  const height = readUint32(data, at + 4);
  const bitDepth = data[at + 8]!;
  const colorType = data[at + 9]!;
  const compression = data[at + 10]!;
  const filterMethod = data[at + 11]!;
  const interlace = data[at + 12]!;

  if (width === 0 || height === 0) {
    throw new PngStructureError("zero dimension");
  }
  if (width > maxDimension || height > maxDimension) {
    throw new PngStructureError(`dimensions ${width}x${height} exceed ${maxDimension}`);
  }
  if (!PNG_BIT_DEPTHS.includes(bitDepth)) {
    throw new PngStructureError(`invalid bit depth ${bitDepth}`);
  }
  if (!PNG_COLOR_TYPES.includes(colorType)) {
    throw new PngStructureError(`invalid color type ${colorType}`);
  }
  if (compression !== 0) {
    throw new PngStructureError("invalid compression method");
  }
  if (filterMethod !== 0) {
    throw new PngStructureError("invalid filter method");
  }
  if (interlace > 1) {
    throw new PngStructureError("invalid interlace method");
  }
}

export function validatePngStructure(
  file: Uint8Array,
  maxDimension: number = MAX_PNG_DIMENSION,
): void {
  if (
    file.length < PNG_SIGNATURE.length ||
    !PNG_SIGNATURE.every((byte, index) => file[index] === byte)
  ) {
    throw new PngStructureError("PNG signature missing");
  }

  let offset = PNG_SIGNATURE.length;
  let ihdrChecked = false;
  let idatFound = false;

  while (offset < file.length) {
    if (file.length - offset < PNG_CHUNK_HEADER_BYTES) {
      throw new PngStructureError("truncated chunk header");
    }

    const length = readUint32(file, offset);
    const type = chunkType(file, offset + 4);
    if (!type) {
      throw new PngStructureError("invalid chunk type");
    }
    if (length > file.length - offset - PNG_CHUNK_HEADER_BYTES) {
      throw new PngStructureError(`chunk ${type} exceeds file size`);
    }

    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (crc32(file, offset + 4, dataEnd) !== readUint32(file, dataEnd)) {
      throw new PngStructureError(`CRC mismatch in ${type} chunk`);
    }

    if (!ihdrChecked) {
      if (type !== "IHDR") {
        throw new PngStructureError("first chunk is not IHDR");
      }
      if (length !== IHDR_DATA_LENGTH) {
        throw new PngStructureError("invalid IHDR length");
      }
      validateIhdr(file, dataStart, maxDimension);
      ihdrChecked = true;
    } else if (type === "IHDR") {
      throw new PngStructureError("duplicate IHDR");
    }

    if (type === "IDAT") idatFound = true;

    if (type === "IEND") {
      if (!idatFound) {
        throw new PngStructureError("no IDAT chunks before IEND");
      }
      if (dataEnd + 4 !== file.length) {
        throw new PngStructureError("unexpected data after IEND");
      }
      return;
    }

    offset = dataEnd + 4;
  }

  throw new PngStructureError("IEND chunk not found");
}
