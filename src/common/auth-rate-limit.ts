import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AUTH_LOGIN_ROUTE, AUTH_PASSWORD_ROUTE, AUTH_REGISTRATION_ROUTE } from "./auth-routes";
import { sendTooManyRequests } from "./rate-limit-reply";
import {
  MemorySlidingWindowStore,
  SlidingWindowRateLimiter,
  type SlidingWindowStore,
} from "./sliding-window-rate-limiter";

const AUTH_LOGIN_ROUTES = new Set([AUTH_LOGIN_ROUTE, AUTH_REGISTRATION_ROUTE]);
const PASSWORD_CHANGE_ROUTE = AUTH_PASSWORD_ROUTE;
const SIGNOUT_ENDPOINT = "/authserver/signout";

const LOGIN_ATTEMPTS_MESSAGE = "Слишком много попыток входа";
const PASSWORD_ATTEMPTS_MESSAGE = "Слишком много попыток смены пароля";

export interface AuthRateLimitOptions {
  max: number;
  ipMax: number;
  timeWindow: number;
  store?: SlidingWindowStore;
}

export function isAuthLoginRoute(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return AUTH_LOGIN_ROUTES.has(path);
}

export function isSignoutRoute(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return path === SIGNOUT_ENDPOINT;
}

export function isPasswordChangeRoute(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return path === PASSWORD_CHANGE_ROUTE;
}

function buildUsernameKey(request: FastifyRequest): string {
  const body = request.body as { username?: string } | undefined;
  const username = typeof body?.username === "string" ? body.username.toLowerCase() : "";
  return `username:${username || "unknown"}`;
}

function buildIpKey(request: FastifyRequest): string {
  return `ip:${request.ip}`;
}

function buildBearerTokenDigest(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  return new Bun.CryptoHasher("sha256").update(header.slice("Bearer ".length)).digest("hex");
}

export async function registerAuthRateLimit(
  instance: FastifyInstance,
  options: AuthRateLimitOptions,
): Promise<void> {
  const store = options.store ?? new MemorySlidingWindowStore();
  const usernameLimiter = new SlidingWindowRateLimiter(store, {
    max: options.max,
    windowMs: options.timeWindow,
  });
  const ipLimiter = new SlidingWindowRateLimiter(store, {
    max: options.ipMax,
    windowMs: options.timeWindow,
  });
  const tokenLimiter = new SlidingWindowRateLimiter(store, {
    max: options.max,
    windowMs: options.timeWindow,
  });

  instance.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.raw.url ?? "";

    if (isAuthLoginRoute(url) || isSignoutRoute(url)) {
      const usernameHit = await usernameLimiter.hit(buildUsernameKey(request));
      const ipHit = await ipLimiter.hit(buildIpKey(request));
      const denied = usernameHit.allowed ? ipHit : usernameHit;
      if (!denied.allowed) {
        await sendTooManyRequests(reply, LOGIN_ATTEMPTS_MESSAGE, denied.retryAfterMs);
      }
      return;
    }

    if (isPasswordChangeRoute(url)) {
      const digest = buildBearerTokenDigest(request);
      const tokenHit = digest
        ? await tokenLimiter.hit(`token:${digest}`)
        : { allowed: true, retryAfterMs: 0 };
      const ipHit = await ipLimiter.hit(buildIpKey(request));
      const denied = tokenHit.allowed ? ipHit : tokenHit;
      if (!denied.allowed) {
        await sendTooManyRequests(reply, PASSWORD_ATTEMPTS_MESSAGE, denied.retryAfterMs);
      }
    }
  });
}
