import { describe, expect, it } from "bun:test";
import { ASSIGNABLE_ROLES, ROLE_WEIGHTS, isKnownRole, roleWeight } from "../roles";

describe("Иерархия ролей", () => {
  it("веса растут от user к owner", () => {
    expect(ROLE_WEIGHTS.user < ROLE_WEIGHTS.moderator).toBe(true);
    expect(ROLE_WEIGHTS.moderator < ROLE_WEIGHTS.admin).toBe(true);
    expect(ROLE_WEIGHTS.admin < ROLE_WEIGHTS.owner).toBe(true);
  });

  it("isKnownRole распознаёт известные роли и отклоняет неизвестные", () => {
    expect(isKnownRole("user")).toBe(true);
    expect(isKnownRole("moderator")).toBe(true);
    expect(isKnownRole("admin")).toBe(true);
    expect(isKnownRole("owner")).toBe(true);
    expect(isKnownRole("admim")).toBe(false);
    expect(isKnownRole("")).toBe(false);
  });

  it("isKnownRole не видит свойства цепочки прототипов", () => {
    expect(isKnownRole("toString")).toBe(false);
    expect(isKnownRole("constructor")).toBe(false);
    expect(isKnownRole("valueOf")).toBe(false);
    expect(isKnownRole("hasOwnProperty")).toBe(false);
  });

  it("roleWeight отдаёт 0 для прототипных имён ролей", () => {
    expect(roleWeight("toString")).toBe(0);
    expect(roleWeight("constructor")).toBe(0);
  });

  it("roleWeight отдаёт 0 для неизвестной роли", () => {
    expect(roleWeight("owner")).toBe(4);
    expect(roleWeight("admim")).toBe(0);
  });

  it("назначаемые роли не содержат owner", () => {
    expect(ASSIGNABLE_ROLES).not.toContain("owner");
    expect(ASSIGNABLE_ROLES).toContain("admin");
    expect(ASSIGNABLE_ROLES).toContain("moderator");
    expect(ASSIGNABLE_ROLES).toContain("user");
  });
});
