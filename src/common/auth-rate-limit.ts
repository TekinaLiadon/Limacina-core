import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import rateLimit from "@fastify/rate-limit";

type LoginRateLimitHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void> | void;

const AUTH_ROUTES_PREFIXES = ["/v1/common/auth", "/auth"];
const LOGIN_ENDPOINTS = ["/login", "/registration"];

export function isAuthLoginRoute(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  const prefixMatched = AUTH_ROUTES_PREFIXES.some((prefix) => path.startsWith(prefix));
  if (!prefixMatched) return false;
  return LOGIN_ENDPOINTS.some((endpoint) => path.endsWith(endpoint));
}

function buildUsernameKey(request: FastifyRequest): string {
  const body = request.body as { username?: string } | undefined;
  const username = typeof body?.username === "string" ? body.username.toLowerCase() : "";
  return `username:${username || "unknown"}`;
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
  }) as unknown as LoginRateLimitHook;

  instance.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.raw.url ?? "";
    if (!isAuthLoginRoute(url)) return;

    await limitLoginAttempts(request, reply);
  });
}
