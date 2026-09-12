const UNSAFE_PREFIX_CHARS = /[^A-Za-z0-9_-]/g;
const MAX_PREFIX_LENGTH = 64;

export function sanitizeFilePrefix(value: string, fallback: string): string {
  const sanitized = value.replaceAll(UNSAFE_PREFIX_CHARS, "").slice(0, MAX_PREFIX_LENGTH);
  return sanitized.length > 0 ? sanitized : fallback;
}
