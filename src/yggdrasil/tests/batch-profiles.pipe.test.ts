import { describe, expect, it } from "bun:test";
import { BatchProfilesPipe, MAX_PROFILE_NAMES } from "../batch-profiles.pipe";

const pipe = new BatchProfilesPipe();
const transform = (value: unknown): string[] => pipe.transform(value, { type: "body" } as never);

describe("BatchProfilesPipe", () => {
  it("пропускает массив имён", () => {
    expect(transform(["a", "b"])).toEqual(["a", "b"]);
  });

  it("отклоняет не-массив", () => {
    expect(() => transform({ name: "a" })).toThrow("Ожидается массив имён игроков");
  });

  it("отклоняет пустые и не-строковые элементы", () => {
    expect(() => transform(["a", ""])).toThrow("непустыми строками");
    expect(() => transform(["a", 42])).toThrow("непустыми строками");
  });

  it(`допускает ровно ${MAX_PROFILE_NAMES} имён`, () => {
    const names = Array.from({ length: MAX_PROFILE_NAMES }, (_, i) => `player-${i}`);
    expect(transform(names)).toHaveLength(MAX_PROFILE_NAMES);
  });

  it("отклоняет больше MAX_PROFILE_NAMES имён вместо усечения", () => {
    const names = Array.from({ length: MAX_PROFILE_NAMES + 1 }, (_, i) => `player-${i}`);
    expect(() => transform(names)).toThrow("Максимум 10 имён игроков в одном запросе");
  });
});
