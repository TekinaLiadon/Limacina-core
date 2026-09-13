import { describe, expect, it } from "bun:test";
import { mariadbDialect } from "../sql/dialects/mariadb.dialect";
import { postgresDialect } from "../sql/dialects/postgres.dialect";
import { toBoolean } from "../sql/dialects/dialect";

describe("postgresDialect", () => {
  it("оставляет плейсхолдеры $n без изменений", () => {
    const adapted = postgresDialect.toClientQuery("uuid = $1 AND approved = $2", ["uuid-1", true]);

    expect(adapted.sql).toBe("uuid = $1 AND approved = $2");
    expect(adapted.values).toEqual(["uuid-1", true]);
  });

  it("рендерит RETURNING", () => {
    expect(postgresDialect.renderReturning(["id", "username"])).toBe(" RETURNING id, username");
  });

  it("нормализует объектный результат", () => {
    const result = postgresDialect.toQueryResult({ rows: [{ uuid: "u1" }], count: 5 });

    expect(result.rows).toEqual([{ uuid: "u1" }]);
    expect(result.count).toBe(1);
  });

  it("нормализует пустой результат в count 0", () => {
    expect(postgresDialect.toQueryResult({ rows: [], count: 0 })).toEqual({
      rows: [],
      count: 0,
    });
    expect(postgresDialect.toQueryResult({})).toEqual({ rows: [], count: 0 });
  });
});

describe("mariadbDialect", () => {
  it("переписывает $n в ? и переупорядочивает значения", () => {
    const adapted = mariadbDialect.toClientQuery(
      "INSERT INTO users (uuid, username) VALUES ($1, $2)",
      ["uuid-1", "user"],
    );

    expect(adapted.sql).toBe("INSERT INTO users (uuid, username) VALUES (?, ?)");
    expect(adapted.values).toEqual(["uuid-1", "user"]);
  });

  it("поддерживает повторные плейсхолдеры", () => {
    const adapted = mariadbDialect.toClientQuery("a = $2 AND b = $1 AND c = $2", [
      "first",
      "second",
    ]);

    expect(adapted.sql).toBe("a = ? AND b = ? AND c = ?");
    expect(adapted.values).toEqual(["second", "first", "second"]);
  });

  it("рендерит RETURNING — клиент Bun поддерживает его для INSERT и DELETE", () => {
    expect(mariadbDialect.renderReturning(["id"])).toBe(" RETURNING id");
  });

  it("нормализует результат с affectedRows", () => {
    const result = mariadbDialect.toQueryResult({ affectedRows: 3 });

    expect(result.rows).toEqual([]);
    expect(result.count).toBe(3);
  });

  it("читает affectedRows у массива с неперечисляемым свойством", () => {
    const raw: Record<string, unknown>[] = [];
    Object.defineProperty(raw, "affectedRows", { value: 2, enumerable: true });

    const result = mariadbDialect.toQueryResult(raw);

    expect(result.rows).toEqual([]);
    expect(result.count).toBe(2);
  });

  it("нормализует массив строк", () => {
    const result = mariadbDialect.toQueryResult([{ id: 1 }, { id: 2 }]);

    expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.count).toBe(2);
  });

  it("предпочитает строки affectedRows и count", () => {
    const result = mariadbDialect.toQueryResult({
      rows: [{ id: 1 }],
      affectedRows: 5,
      count: 7,
    });

    expect(result.count).toBe(1);
  });
});

describe("toBoolean", () => {
  it("принимает true и 1", () => {
    expect(toBoolean(true)).toBe(true);
    expect(toBoolean(1)).toBe(true);
  });

  it("отклоняет остальные значения", () => {
    expect(toBoolean(false)).toBe(false);
    expect(toBoolean(0)).toBe(false);
    expect(toBoolean(null)).toBe(false);
    expect(toBoolean("1")).toBe(false);
  });
});
