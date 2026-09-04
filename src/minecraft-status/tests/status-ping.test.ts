import { describe, expect, it } from "bun:test";
import { status } from "../minecraft-slp";

describe("status", () => {
  it("возвращает ошибку при недоступном хосте", async () => {
    const result = await status("127.0.0.1", 1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeDefined();
    }
  });
});
