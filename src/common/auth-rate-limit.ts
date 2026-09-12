import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import rateLimit from "@fastify/rate-limit";

type RateLimitHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void> | void;

const AUTH_ROUTES_PREFIX = "/v1/common/auth";
const LOGIN_ENDPOINTS = ["/login", "/registration"];
const PASSWORD_CHANGE_ENDPOINT = "/password";
const SIGNOUT_ENDPOINT = "/authserver/signout";

export function isAuthLoginRoute(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  if (!path.startsWith(AUTH_ROUTES_PREFIX)) return false;
  return LOGIN_ENDPOINTS.some((endpoint) => path.endsWith(endpoint));
}

export function isSignoutRoute(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return path === SIGNOUT_ENDPOINT;
}

export function isPasswordChangeRoute(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  if (!path.startsWith(AUTH_ROUTES_PREFIX)) return false;
  return path.endsWith(PASSWORD_CHANGE_ENDPOINT);
}

function buildUsernameKey(request: FastifyRequest): string {
  const body = request.body as { username?: string } | undefined;
  const username = typeof body?.username === "string" ? body.username.toLowerCase() : "";
  return `username:${username || "unknown"}`;
}

function buildBearerTokenKey(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const digest = new Bun.CryptoHasher("sha256")
      .update(header.slice("Bearer ".length))
      .digest("hex");
    return `token:${digest}`;
  }
  return `ip:${request.ip}`;
}

export async function registerAuthRateLimit(
  instance: FastifyInstance,
  options: { max: number; timeWindow: number },
): Promise<void> {
  await instance.register(rateLimit, {
    global: false,
    nameSpace: "auth-rate-limit",
    keyGenerator: buildUsernameKey,
    errorResponseBuilder: (_request: FastifyRequest, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Слишком много попыток входа. Повторите через ${Math.ceil(context.ttl / 1000)} с.`,
    }),
  });

  const limitLoginAttempts = instance.rateLimit({
    max: options.max,
    timeWindow: options.timeWindow,
    keyGenerator: buildUsernameKey,
  }) as unknown as RateLimitHook;

  const limitPasswordAttempts = instance.rateLimit({
    max: options.max,
    timeWindow: options.timeWindow,
    keyGenerator: buildBearerTokenKey,
    errorResponseBuilder: (_request: FastifyRequest, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Слишком много попыток смены пароля. Повторите через ${Math.ceil(context.ttl / 1000)} с.`,
    }),
  }) as unknown as RateLimitHook;

  instance.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.raw.url ?? "";
    if (isAuthLoginRoute(url) || isSignoutRoute(url)) {
      await limitLoginAttempts(request, reply);
      return;
    }
    if (isPasswordChangeRoute(url)) {
      await limitPasswordAttempts(request, reply);
    }
  });
}
