import { PngStructureError, readPngDimensions, validatePngStructure } from "./png";

export const MAX_TEXTURE_BYTES = 512 * 1024;

export const SKIN_MODELS = ["classic", "slim"] as const;
export type SkinModel = (typeof SKIN_MODELS)[number];

export const SKIN_TEXTURE_SIZES = [
  { width: 64, height: 32 },
  { width: 64, height: 64 },
] as const;
export const CAPE_TEXTURE_SIZES = [
  { width: 64, height: 32 },
  { width: 22, height: 17 },
] as const;
export type TextureKind = "skin" | "cape";

export function isSkinModel(value: string): value is SkinModel {
  return (SKIN_MODELS as readonly string[]).includes(value);
}

export const DEFAULT_SKIN_FILE = "default.png";
export const DEFAULT_SKIN_PATH = `/textures/${DEFAULT_SKIN_FILE}`;

export function buildDefaultSkinUrl(baseUrl: string): string {
  return `${baseUrl}${DEFAULT_SKIN_PATH}`;
}

export function sha256Hex(file: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(new Uint8Array(file));
  return hasher.digest("hex");
}

export function pngStructureErrorMessage(file: Uint8Array): string | null {
  try {
    validatePngStructure(file);
    return null;
  } catch (error) {
    if (!(error instanceof PngStructureError)) throw error;
    return error.message;
  }
}

export function textureDimensionsErrorMessage(file: Uint8Array, kind: TextureKind): string | null {
  const { width, height } = readPngDimensions(file);
  const allowed = kind === "skin" ? SKIN_TEXTURE_SIZES : CAPE_TEXTURE_SIZES;
  if (allowed.some((size) => size.width === width && size.height === height)) return null;
  const sizes = allowed.map((size) => `${size.width}x${size.height}`).join(", ");
  return `dimensions ${width}x${height} (allowed: ${sizes})`;
}

export type TextureFileIssue =
  | { kind: "size"; bytes: number; maxBytes: number }
  | { kind: "structure"; message: string }
  | { kind: "dimensions"; message: string };

export function textureFileIssue(file: Uint8Array, kind: TextureKind): TextureFileIssue | null {
  if (file.length > MAX_TEXTURE_BYTES) {
    return { kind: "size", bytes: file.length, maxBytes: MAX_TEXTURE_BYTES };
  }
  const structureMessage = pngStructureErrorMessage(file);
  if (structureMessage) return { kind: "structure", message: structureMessage };
  const dimensionsMessage = textureDimensionsErrorMessage(file, kind);
  if (dimensionsMessage) return { kind: "dimensions", message: dimensionsMessage };
  return null;
}
