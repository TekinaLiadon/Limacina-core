import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  api,
  BOOTSTRAP_TOKEN_PATH,
  bootFlowApp,
  flowTestsEnabled,
  loginViaApi,
  type FlowApp,
} from "../../utils/tests/flow-postgres";

const describeFlow = describe.skipIf(!flowTestsEnabled());

let flow: FlowApp;

describeFlow("Флоу A: bootstrap овнера", () => {
  beforeAll(async () => {
    flow = await bootFlowApp();
  });

  afterAll(async () => {
    await flow?.cleanup();
  });

  it("первый запуск: токен создаётся, init-owner потребляет его, овнер входит в панель", async () => {
    expect(existsSync(BOOTSTRAP_TOKEN_PATH)).toBeTrue();

    const wrongToken = await api(flow.baseUrl).post("/v1/panel/users/init-owner", {
      username: "flowowner_a",
      password: "owner-pass-1",
      token: "0".repeat(64),
    });
    expect(wrongToken.status).toBe(403);
    const wrongTokenLogin = await loginViaApi(flow.baseUrl, "flowowner_a", "owner-pass-1");
    expect(wrongTokenLogin).toBeUndefined();

    const token = readFileSync(BOOTSTRAP_TOKEN_PATH, "utf-8").trim();
    expect(token).toBeString();
    const created = await api(flow.baseUrl).post("/v1/panel/users/init-owner", {
      username: "flowowner_a",
      password: "owner-pass-1",
      token,
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { uuid: string; username: string };
    expect(createdBody.username).toBe("flowowner_a");
    expect(createdBody.uuid).toBeString();

    expect(existsSync(BOOTSTRAP_TOKEN_PATH)).toBeFalse();

    const ownerLogin = await loginViaApi(flow.baseUrl, "flowowner_a", "owner-pass-1");
    expect(ownerLogin?.role).toBe("owner");
    expect(ownerLogin?.tokens.access_token).toBeString();
    expect(ownerLogin?.tokens.refresh_token).toBeString();
    expect(ownerLogin?.uuid).toBe(createdBody.uuid);

    const again = await api(flow.baseUrl).post("/v1/panel/users/init-owner", {
      username: "another_owner",
      password: "whatever-1",
      token: "a".repeat(64),
    });
    expect(again.status).toBe(409);
  });
});
