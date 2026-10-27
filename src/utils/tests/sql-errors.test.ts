import { describe, expect, it } from "bun:test";
import { isUniqueViolation } from "../sql";

describe("isUniqueViolation", () => {
  it("распознаёт postgres-нарушение уникальности по строковому коду 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("распознаёт postgres-нарушение по строковому errno 23505 (PostgresError в Bun)", () => {
    expect(isUniqueViolation({ code: "ERR_POSTGRES_SERVER_ERROR", errno: "23505" })).toBe(true);
  });

  it("распознаёт mariadb-нарушение по errno 1062", () => {
    expect(isUniqueViolation({ errno: 1062 })).toBe(true);
  });

  it("распознаёт mariadb-нарушение по строковому code ER_DUP_ENTRY", () => {
    expect(isUniqueViolation({ code: "ER_DUP_ENTRY", errno: 1062 })).toBe(true);
  });

  it("распознаёт mariadb-нарушение по числовому code 1062", () => {
    expect(isUniqueViolation({ code: 1062 })).toBe(true);
  });

  it("отклоняет прочие коды, постгресовый errno не-23505 и отсутствие кодов", () => {
    expect(isUniqueViolation({ code: "42P01" })).toBe(false);
    expect(isUniqueViolation({ code: "ER_NO_SUCH_TABLE", errno: 1146 })).toBe(false);
    expect(isUniqueViolation({ errno: "42P01" })).toBe(false);
    expect(isUniqueViolation({})).toBe(false);
  });

  it("отклоняет не-объекты и ошибки без кодов", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
    expect(isUniqueViolation(1062)).toBe(false);
    expect(isUniqueViolation(new Error("duplicate key"))).toBe(false);
  });
});
