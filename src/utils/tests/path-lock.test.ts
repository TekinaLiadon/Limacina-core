import { describe, expect, it } from "bun:test";
import { withPathLock } from "../path-lock";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("withPathLock — сериализация операций", () => {
  it("выполняет функции над одним ключом строго по очереди", async () => {
    const events: string[] = [];
    const firstStarted = deferred();
    const releaseFirst = deferred();

    const first = withPathLock("key-a", async () => {
      events.push("first:start");
      firstStarted.resolve();
      await releaseFirst.promise;
      events.push("first:end");
      return 1;
    });
    const second = withPathLock("key-a", async () => {
      events.push("second:start");
      return 2;
    });

    await firstStarted.promise;
    expect(events).toEqual(["first:start"]);

    releaseFirst.resolve();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("не сериализует разные ключи", async () => {
    const events: string[] = [];
    const firstStarted = deferred();

    const first = withPathLock("key-b", async () => {
      events.push("b:start");
      firstStarted.resolve();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
      events.push("b:end");
    });
    const second = withPathLock("key-c", async () => {
      events.push("c:start");
    });

    await firstStarted.promise;
    await second;
    expect(events).toContain("c:start");

    await first;
    expect(events.indexOf("c:start")).toBeLessThan(events.indexOf("b:end"));
  });

  it("ошибка внутри функции не ломает очередь и не оставляет висячий лок", async () => {
    await expect(
      withPathLock("key-d", async () => {
        throw new Error("внутри лока");
      }),
    ).rejects.toThrow("внутри лока");

    const result = await withPathLock("key-d", async () => "следующий шаг");
    expect(result).toBe("следующий шаг");
  });

  it("возвращает результат функции", async () => {
    const value = await withPathLock("key-e", async () => ({ ok: true }));
    expect(value).toEqual({ ok: true });
  });
});
