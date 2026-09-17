import { describe, expect, it } from "bun:test";
import { MemorySlidingWindowStore, SlidingWindowRateLimiter } from "../sliding-window-rate-limiter";

function buildClock(): { now: () => number; advance: (ms: number) => void } {
  let current = 0;
  return {
    now: (): number => current,
    advance: (ms: number): void => {
      current += ms;
    },
  };
}

describe("SlidingWindowRateLimiter", (): void => {
  it("пропускает ровно max запросов в окне", async (): Promise<void> => {
    const clock = buildClock();
    const limiter = new SlidingWindowRateLimiter(new MemorySlidingWindowStore(), {
      max: 3,
      windowMs: 1_000,
      now: clock.now,
    });

    expect(await limiter.hit("k")).toMatchObject({ allowed: true });
    clock.advance(100);
    expect(await limiter.hit("k")).toMatchObject({ allowed: true });
    clock.advance(100);
    expect(await limiter.hit("k")).toMatchObject({ allowed: true });
  });

  it("запрос сверх лимита запрещён, retryAfterMs — до истечения самого старого хита", async (): Promise<void> => {
    const clock = buildClock();
    const limiter = new SlidingWindowRateLimiter(new MemorySlidingWindowStore(), {
      max: 2,
      windowMs: 1_000,
      now: clock.now,
    });

    await limiter.hit("k");
    clock.advance(300);
    await limiter.hit("k");
    clock.advance(200);

    const denied = await limiter.hit("k");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(500);
  });

  it("окно скользящее: хиты истекают по одному по мере старения", async (): Promise<void> => {
    const clock = buildClock();
    const limiter = new SlidingWindowRateLimiter(new MemorySlidingWindowStore(), {
      max: 2,
      windowMs: 1_000,
      now: clock.now,
    });

    await limiter.hit("k");
    clock.advance(500);
    await limiter.hit("k");
    clock.advance(300);
    expect((await limiter.hit("k")).allowed).toBe(false);

    clock.advance(201);
    expect((await limiter.hit("k")).allowed).toBe(false);

    clock.advance(799);
    expect((await limiter.hit("k")).allowed).toBe(true);

    clock.advance(100);
    const denied = await limiter.hit("k");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(101);
  });

  it("ключи изолированы: исчерпание одного бакета не трогает другой", async (): Promise<void> => {
    const clock = buildClock();
    const limiter = new SlidingWindowRateLimiter(new MemorySlidingWindowStore(), {
      max: 1,
      windowMs: 1_000,
      now: clock.now,
    });

    await limiter.hit("a");
    expect((await limiter.hit("a")).allowed).toBe(false);
    expect((await limiter.hit("b")).allowed).toBe(true);
  });

  it("запрещённые хиты тоже записываются и продлевают блокировку", async (): Promise<void> => {
    const clock = buildClock();
    const limiter = new SlidingWindowRateLimiter(new MemorySlidingWindowStore(), {
      max: 1,
      windowMs: 1_000,
      now: clock.now,
    });

    await limiter.hit("k");
    clock.advance(900);
    expect((await limiter.hit("k")).allowed).toBe(false);
    clock.advance(100);
    expect((await limiter.hit("k")).allowed).toBe(false);
    expect((await limiter.hit("k")).retryAfterMs).toBe(900);
  });
});

describe("MemorySlidingWindowStore", (): void => {
  it("возвращает количество хитов в окне и время самого старого", async (): Promise<void> => {
    const clock = buildClock();
    const store = new MemorySlidingWindowStore();

    await store.record("k", 1_000, 10, clock.now());
    clock.advance(400);
    const result = await store.record("k", 1_000, 10, clock.now());

    expect(result.count).toBe(2);
    expect(result.oldestAt).toBe(0);
  });

  it("устаревшие хиты выбрасываются", async (): Promise<void> => {
    const clock = buildClock();
    const store = new MemorySlidingWindowStore();

    await store.record("k", 1_000, 10, clock.now());
    clock.advance(1_500);
    const result = await store.record("k", 1_000, 10, clock.now());

    expect(result.count).toBe(1);
    expect(result.oldestAt).toBe(1_500);
  });

  it("вытесняет самые старые ключи сверх cap", async (): Promise<void> => {
    const store = new MemorySlidingWindowStore(2);

    await store.record("a", 1_000, 10, 0);
    await store.record("b", 1_000, 10, 0);
    await store.record("c", 1_000, 10, 0);

    expect(store.trackedKeyCount()).toBe(2);
    const a = await store.record("a", 1_000, 10, 0);
    expect(a.count).toBe(1);
  });

  it("обращение к ключу обновляет его позицию в вытеснении", async (): Promise<void> => {
    const store = new MemorySlidingWindowStore(2);

    await store.record("a", 1_000, 10, 0);
    await store.record("b", 1_000, 10, 0);
    await store.record("a", 1_000, 10, 0);
    await store.record("c", 1_000, 10, 0);

    expect(store.trackedKeyCount()).toBe(2);
    const b = await store.record("b", 1_000, 10, 0);
    expect(b.count).toBe(1);
  });
});
