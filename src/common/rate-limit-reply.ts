import type { FastifyReply } from "fastify";

const MIN_RETRY_AFTER_SECONDS = 1;

export async function sendTooManyRequests(
  reply: FastifyReply,
  message: string,
  retryAfterMs: number,
): Promise<void> {
  const retryAfterSeconds = Math.max(Math.ceil(retryAfterMs / 1000), MIN_RETRY_AFTER_SECONDS);
  await reply
    .header("retry-after", retryAfterSeconds)
    .code(429)
    .send({
      statusCode: 429,
      error: "Too Many Requests",
      message: `${message}. Повторите через ${retryAfterSeconds} с.`,
    });
}
