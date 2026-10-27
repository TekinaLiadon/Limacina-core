const QUOTED_IDENTIFIER_PATTERN = String.raw`"(?:[^"\\]|""|\\[\s\S])*"`;
const DOLLAR_QUOTED_PATTERN = String.raw`\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$`;
const PLACEHOLDER_PATTERN = String.raw`\$(\d+)`;

const scannerCache = new Map<string, RegExp>();

function scannerRegex(stringLiteralPattern: string): RegExp {
  const cached = scannerCache.get(stringLiteralPattern);
  if (cached) return cached;
  const regex = new RegExp(
    `${stringLiteralPattern}|${QUOTED_IDENTIFIER_PATTERN}|${DOLLAR_QUOTED_PATTERN}|${PLACEHOLDER_PATTERN}`,
    "g",
  );
  scannerCache.set(stringLiteralPattern, regex);
  return regex;
}

export function replaceSqlPlaceholders(
  sql: string,
  replace: (placeholderIndex: number) => string,
  stringLiteralPattern: string,
): string {
  return sql.replace(scannerRegex(stringLiteralPattern), (match, _tag, placeholder?: string) =>
    placeholder === undefined ? match : replace(Number(placeholder)),
  );
}

export function renumberSqlPlaceholders(
  sql: string,
  offset: number,
  stringLiteralPattern: string,
): string {
  return replaceSqlPlaceholders(sql, (index) => `$${index + offset}`, stringLiteralPattern);
}
