import { describe, expect, it } from "bun:test";
import { HttpException, HttpStatus, type ArgumentsHost } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AllExceptionsFilter } from "../all-exceptions.filter";

interface ReplyState {
  sent: boolean;
  statusCode: number | undefined;
  body: unknown;
}

function createReplyMock(initial: Partial<ReplyState> = {}): {
  reply: FastifyReply;
  state: ReplyState;
} {
  const state: ReplyState = {
    sent: false,
    statusCode: undefined,
    body: undefined,
    ...initial,
  };

  const reply = {
    get sent() {
      return state.sent;
    },
    status(code: number) {
      state.statusCode = code;
      return reply;
    },
    send(body: unknown) {
      state.body = body;
      return reply;
    },
  };

  return { reply: reply as unknown as FastifyReply, state };
}

function createHostMock(reply: FastifyReply): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => reply }),
  } as unknown as ArgumentsHost;
}

describe("AllExceptionsFilter", () => {
  const filter = new AllExceptionsFilter();

  it("пробрасывает HttpException с её статусом и телом", () => {
    const { reply, state } = createReplyMock();
    const exception = new BadRequestBodyException();

    filter.catch(exception, createHostMock(reply));

    expect(state.statusCode).toBe(400);
    expect(state.body).toEqual({
      statusCode: 400,
      message: "Юзернейм уже занят",
      error: "Bad Request",
    });
  });

  it("маппит ошибку fastify с statusCode 413 вместо 500", () => {
    const { reply, state } = createReplyMock();
    const exception = Object.assign(new Error("request file too large"), { statusCode: 413 });

    filter.catch(exception, createHostMock(reply));

    expect(state.statusCode).toBe(413);
    expect(state.body).toEqual({ statusCode: 413, message: "request file too large" });
  });

  it("маппит ошибку fastify с statusCode 406 вместо 500", () => {
    const { reply, state } = createReplyMock();
    const exception = Object.assign(new Error("the request is not multipart"), {
      statusCode: 406,
    });

    filter.catch(exception, createHostMock(reply));

    expect(state.statusCode).toBe(406);
  });

  it("возвращает 500 с генерическим телом для неизвестной ошибки", () => {
    const { reply, state } = createReplyMock();

    filter.catch(new Error("boom with secret stack"), createHostMock(reply));

    expect(state.statusCode).toBe(500);
    expect(state.body).toEqual({ statusCode: 500, message: "Internal Server Error" });
  });

  it("возвращает 500 для не-Error исключения", () => {
    const { reply, state } = createReplyMock();

    filter.catch("plain string failure", createHostMock(reply));

    expect(state.statusCode).toBe(500);
    expect(state.body).toEqual({ statusCode: 500, message: "Internal Server Error" });
  });

  it("игнорирует statusCode вне диапазона 4xx/5xx", () => {
    const { reply, state } = createReplyMock();
    const exception = Object.assign(new Error("redirect-ish"), { statusCode: 302 });

    filter.catch(exception, createHostMock(reply));

    expect(state.statusCode).toBe(500);
  });

  it("не отправляет ответ, если он уже отправлен", () => {
    const { reply, state } = createReplyMock({ sent: true });

    filter.catch(new Error("late failure"), createHostMock(reply));

    expect(state.statusCode).toBeUndefined();
    expect(state.body).toBeUndefined();
  });
});

class BadRequestBodyException extends HttpException {
  constructor() {
    super(
      { statusCode: HttpStatus.BAD_REQUEST, message: "Юзернейм уже занят", error: "Bad Request" },
      HttpStatus.BAD_REQUEST,
    );
  }
}
