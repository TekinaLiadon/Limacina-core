import { describe, expect, it } from "bun:test";
import { mariadbDialect } from "../sql/dialects/mariadb.dialect";
import { postgresDialect } from "../sql/dialects/postgres.dialect";
import { renumberSqlPlaceholders, replaceSqlPlaceholders } from "../sql/placeholders";

const mariadbLiterals = mariadbDialect.stringLiteralPattern;
const postgresLiterals = postgresDialect.stringLiteralPattern;

describe("replaceSqlPlaceholders", () => {
  it("заменяет $n вне строковых литералов", () => {
    expect(
      replaceSqlPlaceholders("uuid = $2 AND approved = $1", (index) => `?${index}`, mariadbLiterals),
    ).toBe("uuid = ?2 AND approved = ?1");
  });

  it("mariadb: не трогает $n внутри литерала с бэкслэш-экранированной кавычкой", () => {
    expect(
      replaceSqlPlaceholders(
        "name = 'O\\'Brien $1' AND uuid = $1",
        (index) => `?${index}`,
        mariadbLiterals,
      ),
    ).toBe("name = 'O\\'Brien $1' AND uuid = ?1");
  });

  it("mariadb: закрывает литерал после бэкслэш-экранированного бэкслэша", () => {
    expect(
      replaceSqlPlaceholders(
        "note = 'a\\\\b $1' AND uuid = $1",
        (index) => `?${index}`,
        mariadbLiterals,
      ),
    ).toBe("note = 'a\\\\b $1' AND uuid = ?1");
  });

  it("mariadb: бэкслэш до кавычки продолжает литерал — $n внутри не заменяется", () => {
    expect(
      replaceSqlPlaceholders(
        "note = 'x\\' AND flag = $1 AND title = 't'",
        (index) => `?${index}`,
        mariadbLiterals,
      ),
    ).toBe("note = 'x\\' AND flag = $1 AND title = 't'");
  });

  it("mariadb: не трогает $n внутри двойных кавычек идентификатора", () => {
    expect(
      replaceSqlPlaceholders(
        'SELECT "rank$1" FROM t WHERE uuid = $2',
        (index) => `?${index}`,
        mariadbLiterals,
      ),
    ).toBe('SELECT "rank$1" FROM t WHERE uuid = ?2');
  });

  it("mariadb: не трогает доллар-квоты и удвоенные кавычки", () => {
    expect(
      replaceSqlPlaceholders(
        "note = $$цена $2$$ AND b = 'он сказал ''$1''' AND uuid = $1",
        (index) => `?${index}`,
        mariadbLiterals,
      ),
    ).toBe("note = $$цена $2$$ AND b = 'он сказал ''$1''' AND uuid = ?1");
  });

  it("postgres: закрывает литерал после обратного слэша и заменяет следующий плейсхолдер", () => {
    expect(
      replaceSqlPlaceholders(
        "note = 'x\\' AND flag = $1 AND title = 't'",
        (index) => `?${index}`,
        postgresLiterals,
      ),
    ).toBe("note = 'x\\' AND flag = ?1 AND title = 't'");
  });

  it("postgres: не трогает $n внутри удвоенных кавычек литерала", () => {
    expect(
      replaceSqlPlaceholders(
        "b = 'он сказал ''$1''' AND uuid = $1",
        (index) => `?${index}`,
        postgresLiterals,
      ),
    ).toBe("b = 'он сказал ''$1''' AND uuid = ?1");
  });

  it("postgres: не трогает $n внутри двойных кавычек идентификатора и доллар-квот", () => {
    expect(
      replaceSqlPlaceholders(
        'SELECT "rank$1" FROM t WHERE note = $$цена $2$$ AND uuid = $1',
        (index) => `?${index}`,
        postgresLiterals,
      ),
    ).toBe('SELECT "rank$1" FROM t WHERE note = $$цена $2$$ AND uuid = ?1');
  });
});

describe("renumberSqlPlaceholders", () => {
  it("mariadb: перенумеровывает плейсхолдеры со смещением, не трогая литералы и идентификаторы", () => {
    expect(
      renumberSqlPlaceholders(
        "a = $1 AND note = 'O\\'Brien $2' AND \"c$1\" = $2",
        2,
        mariadbLiterals,
      ),
    ).toBe("a = $3 AND note = 'O\\'Brien $2' AND \"c$1\" = $4");
  });

  it("postgres: литерал с обратным слэшем закрыт, плейсхолдеры после него перенумерованы", () => {
    expect(
      renumberSqlPlaceholders("note = 'x\\' AND a = $1 AND b = $2", 2, postgresLiterals),
    ).toBe("note = 'x\\' AND a = $3 AND b = $4");
  });
});
