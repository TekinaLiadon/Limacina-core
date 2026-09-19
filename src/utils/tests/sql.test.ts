import { describe, expect, it } from "bun:test";
import { selectQuery, updateColumnQuery, setSoftDeletedQuery, TABLES } from "../sql";

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

  it("добавляет FOR UPDATE после пагинации", () => {
    const query = selectQuery("uuid")
      .from(TABLES.users)
      .where("uuid = $1", "abc")
      .forUpdate()
      .build();

    expect(query.sql).toBe("SELECT uuid FROM users WHERE uuid = $1 FOR UPDATE");
    expect(query.values).toEqual(["abc"]);
  });
});

describe("updateColumnQuery", () => {
  it("строит UPDATE одной колонки с перенумерацией плейсхолдера where", () => {
    const query = updateColumnQuery(TABLES.users, "approved", true, "uuid = $1", "u1");

    expect(query.sql).toBe("UPDATE users SET approved = $1 WHERE uuid = $2");
    expect(query.values).toEqual([true, "u1"]);
  });
});

describe("setSoftDeletedQuery", () => {
  it("пометка удаления ставит deleted_at и фильтрует живые строки", () => {
    const query = setSoftDeletedQuery(TABLES.users, "uuid = $1", "u1", true);

    expect(query.sql).toBe(
      "UPDATE users SET deleted = $1, deleted_at = $2 WHERE uuid = $3 AND deleted = false",
    );
    expect(query.values[0]).toBe(true);
    expect(query.values[1]).toBeInstanceOf(Date);
    expect(query.values[2]).toBe("u1");
  });

  it("восстановление сбрасывает deleted_at и фильтрует удалённые строки", () => {
    const query = setSoftDeletedQuery(TABLES.users, "username = $1", "john", false);

    expect(query.sql).toBe(
      "UPDATE users SET deleted = $1, deleted_at = $2 WHERE username = $3 AND deleted = true",
    );
    expect(query.values[0]).toBe(false);
    expect(query.values[1]).toBeNull();
    expect(query.values[2]).toBe("john");
  });

  it("перенумеровывает плейсхолдеры внутри подзапроса", () => {
    const query = setSoftDeletedQuery(
      TABLES.users,
      "uuid = (SELECT uuid FROM users WHERE username = $1 AND deleted = true ORDER BY deleted_at DESC LIMIT 1)",
      "john",
      false,
    );

    expect(query.sql).toBe(
      "UPDATE users SET deleted = $1, deleted_at = $2 WHERE uuid = (SELECT uuid FROM users WHERE username = $3 AND deleted = true ORDER BY deleted_at DESC LIMIT 1) AND deleted = true",
    );
    expect(query.values).toEqual([false, null, "john"]);
  });
});
