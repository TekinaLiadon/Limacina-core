import { describe, expect, it } from "bun:test";
import { renumberSqlPlaceholders, replaceSqlPlaceholders } from "../sql/placeholders";

describe("replaceSqlPlaceholders", () => {
  it("заменяет $n вне строковых литералов", () => {
    expect(replaceSqlPlaceholders("uuid = $2 AND approved = $1", (index) => `?${index}`)).toBe(
      "uuid = ?2 AND approved = ?1",
    );
  });

  it("не трогает $n внутри литерала с бэкслэш-экранированной кавычкой", () => {
    expect(
      replaceSqlPlaceholders("name = 'O\\'Brien $1' AND uuid = $1", (index) => `?${index}`),
    ).toBe("name = 'O\\'Brien $1' AND uuid = ?1");
  });

  it("закрывает литерал после бэкслэш-экранированного бэкслэша", () => {
    expect(replaceSqlPlaceholders("note = 'a\\\\b $1' AND uuid = $1", (index) => `?${index}`)).toBe(
      "note = 'a\\\\b $1' AND uuid = ?1",
    );
  });

  it("не трогает $n внутри двойных кавычек идентификатора", () => {
    expect(
      replaceSqlPlaceholders('SELECT "rank$1" FROM t WHERE uuid = $2', (index) => `?${index}`),
    ).toBe('SELECT "rank$1" FROM t WHERE uuid = ?2');
  });

  it("не трогает доллар-квоты и удвоенные кавычки", () => {
    expect(
      replaceSqlPlaceholders(
        "note = $$цена $2$$ AND b = 'он сказал ''$1''' AND uuid = $1",
        (index) => `?${index}`,
      ),
    ).toBe("note = $$цена $2$$ AND b = 'он сказал ''$1''' AND uuid = ?1");
  });
});

describe("renumberSqlPlaceholders", () => {
  it("перенумеровывает плейсхолдеры со смещением, не трогая литералы и идентификаторы", () => {
    expect(renumberSqlPlaceholders("a = $1 AND note = 'O\\'Brien $2' AND \"c$1\" = $2", 2)).toBe(
      "a = $3 AND note = 'O\\'Brien $2' AND \"c$1\" = $4",
    );
  });
});
