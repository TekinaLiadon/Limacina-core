import { describe, expect, it } from "bun:test";
import { selectQuery, TABLES } from "../sql";

describe("selectQuery", () => {
  it("строит запрос без where, сортировки и пагинации", () => {
    const query = selectQuery("uuid", "username").from(TABLES.users).build();

    expect(query.sql).toBe("SELECT uuid, username FROM users");
    expect(query.values).toEqual([]);
  });

  it("добавляет ORDER BY, LIMIT и OFFSET", () => {
    const query = selectQuery("uuid", "username")
      .from(TABLES.users)
      .orderBy("username")
      .limit(10)
      .offset(20)
      .build();

    expect(query.sql).toBe(
      "SELECT uuid, username FROM users ORDER BY username ASC LIMIT 10 OFFSET 20",
    );
    expect(query.values).toEqual([]);
  });

  it("поддерживает несколько колонок и направление сортировки", () => {
    const query = selectQuery("uuid")
      .from(TABLES.users)
      .orderBy("role")
      .orderBy("username", "desc")
      .build();

    expect(query.sql).toBe("SELECT uuid FROM users ORDER BY role ASC, username DESC");
  });

  it("сочетает where/and с сортировкой и пагинацией", () => {
    const query = selectQuery("uuid")
      .from(TABLES.users)
      .where("username ILIKE $1", "%a%")
      .and("approved = $2", false)
      .orderBy("username")
      .limit(5)
      .offset(10)
      .build();

    expect(query.sql).toBe(
      "SELECT uuid FROM users WHERE username ILIKE $1 AND approved = $2 ORDER BY username ASC LIMIT 5 OFFSET 10",
    );
    expect(query.values).toEqual(["%a%", false]);
  });

  it("соединяет повторные where через AND", () => {
    const query = selectQuery("uuid")
      .from(TABLES.users)
      .where("username ILIKE $1", "%a%")
      .where("approved = $2", false)
      .build();

    expect(query.sql).toBe("SELECT uuid FROM users WHERE username ILIKE $1 AND approved = $2");
    expect(query.values).toEqual(["%a%", false]);
  });

  it("сохраняет join перед where и limit", () => {
    const query = selectQuery("u.uuid", "t.skin_url")
      .from(TABLES.users, "u")
      .join("LEFT JOIN", TABLES.user_textures, "t", "t.uuid = u.uuid")
      .where("u.username = $1", "john")
      .limit(1)
      .build();

    expect(query.sql).toBe(
      "SELECT u.uuid, t.skin_url FROM users u LEFT JOIN user_textures t ON t.uuid = u.uuid WHERE u.username = $1 LIMIT 1",
    );
    expect(query.values).toEqual(["john"]);
  });
});
