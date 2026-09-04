import { describe, expect, it } from "bun:test";
import { extractStatusJson } from "../minecraft-slp";

describe("extractStatusJson", () => {
  it("парсит валидный ответ статуса", () => {
    const json = JSON.stringify({
      version: { name: "1.20.4", protocol: 765 },
      players: { max: 20, online: 7 },
    });
    const payload = new TextEncoder().encode(json);

    const result = extractStatusJson(payload);

    expect(result.online).toBe(7);
    expect(result.max).toBe(20);
    expect(result.version).toBe("1.20.4");
  });

  it("подставляет unknown при отсутствии имени версии", () => {
    const json = JSON.stringify({ players: { max: 5, online: 1 } });
    const payload = new TextEncoder().encode(json);

    const result = extractStatusJson(payload);

    expect(result.version).toBe("unknown");
  });

  it("выбрасывает ошибку при отсутствии players.online", () => {
    const payload = new TextEncoder().encode(JSON.stringify({ version: { name: "1.0" } }));

    expect(() => extractStatusJson(payload)).toThrow();
  });

  it("выбрасывает ошибку при отсутствии players.max", () => {
    const payload = new TextEncoder().encode(JSON.stringify({ players: { online: 3 } }));

    expect(() => extractStatusJson(payload)).toThrow();
  });

  it("выбрасывает ошибку при невалидном JSON", () => {
    const payload = new TextEncoder().encode("nope");

    expect(() => extractStatusJson(payload)).toThrow();
  });
});
