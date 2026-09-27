const SQL_LITERAL_OR_PLACEHOLDER =
  /'(?:[^']|'')*'|\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$|\$(\d+)/g;

export function replaceSqlPlaceholders(
  sql: string,
  replace: (placeholderIndex: number) => string,
): string {
  return sql.replace(SQL_LITERAL_OR_PLACEHOLDER, (match, _tag, placeholder?: string) =>
    placeholder === undefined ? match : replace(Number(placeholder)),
  );
}

export function renumberSqlPlaceholders(sql: string, offset: number): string {
  return replaceSqlPlaceholders(sql, (index) => `$${index + offset}`);
}
