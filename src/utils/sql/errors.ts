const PG_UNIQUE_VIOLATION_CODE = "23505";
const MARIA_UNIQUE_VIOLATION_CODE = 1062;

export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, errno } = error as { code?: unknown; errno?: unknown };
  return (
    code === PG_UNIQUE_VIOLATION_CODE ||
    errno === PG_UNIQUE_VIOLATION_CODE ||
    errno === MARIA_UNIQUE_VIOLATION_CODE
  );
}
