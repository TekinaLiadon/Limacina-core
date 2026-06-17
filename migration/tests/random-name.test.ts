import { describe, it, expect } from "bun:test";
import { randomName } from "../core/random-name.js";

describe("randomName()", () => {
  it("генерирует имя в формате adjective_noun", () => {
    const name = randomName();
    expect(name).toMatch(/^[a-z]+_[a-z]+$/);
  });

  it("содержит разделитель _", () => {
    const name = randomName();
    const parts = name.split("_");
    expect(parts.length).toBe(2);
    expect(parts[0]!.length).toBeGreaterThan(0);
    expect(parts[1]!.length).toBeGreaterThan(0);
  });

  it("генерирует уникальные имена (не всегда, но на 100 попыток хотя бы 2 разных)", () => {
    const names = new Set<string>();
    for (let i = 0; i < 100; i++) {
      names.add(randomName());
    }
    expect(names.size).toBeGreaterThan(1);
  });
});
