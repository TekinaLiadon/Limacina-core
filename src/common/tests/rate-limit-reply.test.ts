import { describe, expect, it } from "bun:test";
import type { FastifyReply } from "fastify";
import { sendTooManyRequests } from "../rate-limit-reply";

interface ReplyState {
  headers: Record<string, unknown>;
  statusCode: number;
  body: unknown;
}

const recordReply = (): { reply: FastifyReply; state: ReplyState } => {
  const state: ReplyState = { headers: {}, statusCode: 0, body: undefined };
  const reply = {
    header: (name: string, value: unknown) => {
      state.headers[name] = value;
      return reply;
    },
    code: (code: number) => {
      state.statusCode = code;
      return reply;
    },
    send: async (body: unknown) => {
      state.body = body;
    },
  } as unknown as FastifyReply;
  return { reply, state };
};

const bodyMessage = (state: ReplyState): string => (state.body as { message: string }).message;

describe("sendTooManyRequests (TASK-411.19)", () => {
  it("ставит Retry-After (ceil) и 429 с русским сообщением", async () => {
    const { reply, state } = recordReply();
    await sendTooManyRequests(reply, "Слишком много попыток входа", 2500);

    expect(state.statusCode).toBe(429);
    expect(state.headers["retry-after"]).toBe(3);
    expect(state.body).toMatchObject({ statusCode: 429, error: "Too Many Requests" });
    expect(bodyMessage(state)).toBe("Слишком много попыток входа. Повторите через 3 с.");
  });

  it("пауза меньше секунды округляется до минимума в 1 секунду", async () => {
    const { reply, state } = recordReply();
    await sendTooManyRequests(reply, "Слишком много запросов", 0);

    expect(state.headers["retry-after"]).toBe(1);
    expect(bodyMessage(state)).toBe("Слишком много запросов. Повторите через 1 с.");
  });

  it("почти истёкшая секунда округляется вверх до 1", async () => {
    const { reply, state } = recordReply();
    await sendTooManyRequests(reply, "Слишком много запросов", 1);

    expect(state.headers["retry-after"]).toBe(1);
    expect(bodyMessage(state)).toBe("Слишком много запросов. Повторите через 1 с.");
  });
});
