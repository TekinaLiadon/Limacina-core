import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendTooManyRequests } from "./rate-limit-reply";
import {
  MemorySlidingWindowStore,
  SlidingWindowRateLimiter,
  type SlidingWindowStore,
} from "./sliding-window-rate-limiter";

export interface GlobalRateLimitOptions {
  max: number;
  timeWindow: number;
  store?: SlidingWindowStore;
}

export async function registerGlobalRateLimit(
  instance: FastifyInstance,
  options: GlobalRateLimitOptions,
): Promise<void> {
  const limiter = new SlidingWindowRateLimiter(options.store ?? new MemorySlidingWindowStore(), {
    max: options.max,
    windowMs: options.timeWindow,
  });

  instance.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const hit = await limiter.hit(`global-ip:${request.ip}`);
    if (hit.allowed) return;

    await sendTooManyRequests(reply, "Слишком много запросов", hit.retryAfterMs);
  });
}
