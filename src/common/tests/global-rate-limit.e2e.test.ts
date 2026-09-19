import { describe, afterAll, beforeAll, expect, it } from "bun:test";
import Fastify, { type FastifyInstance } from "fastify";
import supertest from "supertest";
import { registerGlobalRateLimit } from "../global-rate-limit";

describe("Глобальный rate limit по IP", (): void => {
  let app: FastifyInstance;

  beforeAll(async (): Promise<void> => {
    app = Fastify({ trustProxy: true });
    await registerGlobalRateLimit(app, { max: 3, timeWindow: 60_000 });
    app.get("/ping", async (): Promise<{ ok: boolean }> => ({ ok: true }));
    await app.ready();
  });

  afterAll(async (): Promise<void> => {
    await app.close();
  });

  it("пропускает запросы до лимита, сверх — 429 с русским сообщением", async (): Promise<void> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await supertest(app.server).get("/ping").set("X-Forwarded-For", "10.0.0.1").expect(200);
    }

    const res = await supertest(app.server)
      .get("/ping")
      .set("X-Forwarded-For", "10.0.0.1")
      .expect(429);

    expect(res.body).toMatchObject({
      statusCode: 429,
      error: "Too Many Requests",
    });
    expect(res.body.message).toMatch(/^Слишком много запросов\. Повторите через \d+ с\.$/);
  });

  it("другой IP не затронут бакетом первого", async (): Promise<void> => {
    const res = await supertest(app.server)
      .get("/ping")
      .set("X-Forwarded-For", "10.9.9.9")
      .expect(200);

    expect(res.body).toEqual({ ok: true });
  });
});
