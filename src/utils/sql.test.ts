import { describe, it, expect } from "bun:test";
import { selectQuery, insertQuery, updateQuery, deleteQuery, TABLES } from "./sql";

describe("selectQuery", () => {
  it("select specific columns", () => {
    const q = selectQuery("id", "name").from(TABLES.users).build();
    expect(q.sql).toBe("SELECT id, name FROM users");
    expect(q.values).toEqual([]);
  });

  it("select all columns", () => {
    const q = selectQuery().from(TABLES.users).build();
    expect(q.sql).toBe("SELECT * FROM users");
  });

  it("select with where", () => {
    const q = selectQuery("id").from(TABLES.users).where("username = $1", "john").build();
    expect(q.sql).toBe("SELECT id FROM users WHERE username = $1");
    expect(q.values).toEqual(["john"]);
  });

  it("select with where+and", () => {
    const q = selectQuery("*")
      .from(TABLES.users)
      .where("active = $1", true)
      .and("role = $2", "admin")
      .build();
    expect(q.sql).toBe("SELECT * FROM users WHERE active = $1 AND role = $2");
    expect(q.values).toEqual([true, "admin"]);
  });

  it("select with limit", () => {
    const q = selectQuery("id").from(TABLES.users).limit(10).build();
    expect(q.sql).toBe("SELECT id FROM users LIMIT 10");
  });

  it("select with where and limit", () => {
    const q = selectQuery("*").from(TABLES.users).where("id = $1", 1).limit(5).build();
    expect(q.sql).toBe("SELECT * FROM users WHERE id = $1 LIMIT 5");
    expect(q.values).toEqual([1]);
  });

  it("select with where+and and limit", () => {
    const q = selectQuery("id")
      .from(TABLES.users)
      .where("a = $1", 1)
      .and("b = $2", 2)
      .limit(3)
      .build();
    expect(q.sql).toBe("SELECT id FROM users WHERE a = $1 AND b = $2 LIMIT 3");
    expect(q.values).toEqual([1, 2]);
  });

  it("select from refresh_tokens", () => {
    const q = selectQuery("user_id", "username")
      .from(TABLES.refresh_tokens)
      .where("jti = $1", "token123")
      .build();
    expect(q.sql).toBe("SELECT user_id, username FROM refresh_tokens WHERE jti = $1");
    expect(q.values).toEqual(["token123"]);
  });

  it("select with table alias", () => {
    const q = selectQuery("u.uuid", "u.username").from(TABLES.users, "u").build();
    expect(q.sql).toBe("SELECT u.uuid, u.username FROM users u");
    expect(q.values).toEqual([]);
  });

  it("select with left join", () => {
    const q = selectQuery("u.uuid", "t.skin_url")
      .from(TABLES.users, "u")
      .join("LEFT JOIN", TABLES.user_textures, "t", "t.uuid = u.uuid")
      .build();
    expect(q.sql).toBe(
      `SELECT u.uuid, t.skin_url FROM users u LEFT JOIN user_textures t ON t.uuid = u.uuid`,
    );
    expect(q.values).toEqual([]);
  });

  it("select with left join and where", () => {
    const q = selectQuery("u.uuid", "t.skin_url")
      .from(TABLES.users, "u")
      .join("LEFT JOIN", TABLES.user_textures, "t", "t.uuid = u.uuid")
      .where("u.uuid = $1", "abc")
      .build();
    expect(q.sql).toBe(
      `SELECT u.uuid, t.skin_url FROM users u LEFT JOIN user_textures t ON t.uuid = u.uuid WHERE u.uuid = $1`,
    );
    expect(q.values).toEqual(["abc"]);
  });

  it("select with left join, where and limit", () => {
    const q = selectQuery("u.uuid", "t.skin_url")
      .from(TABLES.users, "u")
      .join("LEFT JOIN", TABLES.user_textures, "t", "t.uuid = u.uuid")
      .where("u.username = $1", "john")
      .limit(10)
      .build();
    expect(q.sql).toBe(
      `SELECT u.uuid, t.skin_url FROM users u LEFT JOIN user_textures t ON t.uuid = u.uuid WHERE u.username = $1 LIMIT 10`,
    );
    expect(q.values).toEqual(["john"]);
  });

  it("select with join and where+and", () => {
    const q = selectQuery("u.uuid")
      .from(TABLES.users, "u")
      .join("LEFT JOIN", TABLES.user_textures, "t", "t.uuid = u.uuid")
      .where("u.username = $1", "john")
      .and("t.skin_url IS NOT NULL")
      .build();
    expect(q.sql).toBe(
      `SELECT u.uuid FROM users u LEFT JOIN user_textures t ON t.uuid = u.uuid WHERE u.username = $1 AND t.skin_url IS NOT NULL`,
    );
    expect(q.values).toEqual(["john"]);
  });

  it("select with inner join", () => {
    const q = selectQuery("u.uuid", "t.skin_url")
      .from(TABLES.users, "u")
      .join("INNER JOIN", TABLES.user_textures, "t", "t.uuid = u.uuid")
      .build();
    expect(q.sql).toBe(
      `SELECT u.uuid, t.skin_url FROM users u INNER JOIN user_textures t ON t.uuid = u.uuid`,
    );
  });
});

describe("insertQuery", () => {
  it("insert single row", () => {
    const q = insertQuery("uuid", "username").from(TABLES.users).values("u1", "john").build();
    expect(q.sql).toBe("INSERT INTO users (uuid, username) VALUES ($1, $2)");
    expect(q.values).toEqual(["u1", "john"]);
  });

  it("insert with returning", () => {
    const q = insertQuery("uuid", "username")
      .from(TABLES.users)
      .values("u1", "john")
      .returning("uuid")
      .build();
    expect(q.sql).toBe("INSERT INTO users (uuid, username) VALUES ($1, $2) RETURNING uuid");
    expect(q.values).toEqual(["u1", "john"]);
  });
});

describe("updateQuery", () => {
  it("update single column", () => {
    const q = updateQuery()
      .from(TABLES.users)
      .set("username", "jane")
      .where("uuid = $1", "u1")
      .build();
    expect(q.sql).toBe("UPDATE users SET username = $1 WHERE uuid = $2");
    expect(q.values).toEqual(["jane", "u1"]);
  });

  it("update multiple columns", () => {
    const q = updateQuery()
      .from(TABLES.users)
      .set("username", "jane")
      .set("password_hash", "hashed")
      .where("uuid = $1", "u1")
      .build();
    expect(q.sql).toBe("UPDATE users SET username = $1, password_hash = $2 WHERE uuid = $3");
    expect(q.values).toEqual(["jane", "hashed", "u1"]);
  });

  it("update with returning", () => {
    const q = updateQuery()
      .from(TABLES.users)
      .set("username", "jane")
      .where("uuid = $1", "u1")
      .returning("uuid", "username")
      .build();
    expect(q.sql).toBe("UPDATE users SET username = $1 WHERE uuid = $2 RETURNING uuid, username");
    expect(q.values).toEqual(["jane", "u1"]);
  });
});

describe("deleteQuery", () => {
  it("delete with where", () => {
    const q = deleteQuery().from(TABLES.users).where("uuid = $1", "u1").build();
    expect(q.sql).toBe("DELETE FROM users WHERE uuid = $1");
    expect(q.values).toEqual(["u1"]);
  });

  it("delete with limit", () => {
    const q = deleteQuery().from(TABLES.users).limit(5).build();
    expect(q.sql).toBe("DELETE FROM users LIMIT 5");
  });

  it("delete with where and limit", () => {
    const q = deleteQuery()
      .from(TABLES.refresh_tokens)
      .where("user_id = $1", "u1")
      .limit(10)
      .build();
    expect(q.sql).toBe("DELETE FROM refresh_tokens WHERE user_id = $1 LIMIT 10");
    expect(q.values).toEqual(["u1"]);
  });
});
