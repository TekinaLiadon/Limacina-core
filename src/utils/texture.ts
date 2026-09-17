import { PngStructureError, validatePngStructure } from "./png";

export const MAX_TEXTURE_BYTES = 512 * 1024;

export const SKIN_MODELS = ["classic", "slim"] as const;
export type SkinModel = (typeof SKIN_MODELS)[number];

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
