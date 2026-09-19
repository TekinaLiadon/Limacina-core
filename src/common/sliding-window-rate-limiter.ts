export interface SlidingWindowResult {
  count: number;
  oldestAt: number | null;
}

export interface SlidingWindowStore {
  record(key: string, windowMs: number, max: number, nowMs: number): Promise<SlidingWindowResult>;
}

export interface SlidingWindowLimiterOptions {
  max: number;
  windowMs: number;
  now?: () => number;
}

export interface SlidingWindowHit {
  allowed: boolean;
  retryAfterMs: number;
}

export class SlidingWindowRateLimiter {
  private readonly now: () => number;

  constructor(
    private readonly store: SlidingWindowStore,
    private readonly options: SlidingWindowLimiterOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  async hit(key: string): Promise<SlidingWindowHit> {
    const { count, oldestAt } = await this.store.record(
      key,
      this.options.windowMs,
      this.options.max,
      this.now(),
    );
    if (count <= this.options.max) {
      return { allowed: true, retryAfterMs: 0 };
    }

    const oldest = oldestAt ?? this.now();
    return {
      allowed: false,
      retryAfterMs: Math.max(oldest + this.options.windowMs - this.now(), 0),
    };
  }
}

const DEFAULT_MAX_TRACKED_KEYS = 10_000;

export class MemorySlidingWindowStore implements SlidingWindowStore {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly maxKeys: number = DEFAULT_MAX_TRACKED_KEYS) {}

  async record(
    key: string,
    windowMs: number,
    _max: number,
    nowMs: number,
  ): Promise<SlidingWindowResult> {
    this.refreshKey(key);

    const windowStart = nowMs - windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((at) => at > windowStart);
    timestamps.push(nowMs);
    this.hits.set(key, timestamps);
    this.evictOverflow(key);

    return { count: timestamps.length, oldestAt: timestamps[0] ?? null };
  }

  trackedKeyCount(): number {
    return this.hits.size;
  }

  private refreshKey(key: string): void {
    if (!this.hits.has(key)) return;
    const timestamps = this.hits.get(key);
    if (timestamps === undefined) return;
    this.hits.delete(key);
    this.hits.set(key, timestamps);
  }

  private evictOverflow(protectedKey: string): void {
    while (this.hits.size > this.maxKeys) {
      const oldestKey = this.hits.keys().next().value;
      if (oldestKey === undefined || oldestKey === protectedKey) break;
      this.hits.delete(oldestKey);
    }
  }
}
