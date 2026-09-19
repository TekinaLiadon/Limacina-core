import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  api,
  bootFlowApp,
  createApprovedPlayer,
  flowTestsEnabled,
  type AuthData,
  type FlowApp,
} from "../../utils/tests/flow-postgres";

const OWNER = { username: "flsa-owner", password: "owner-pass-1" };

const describeFlow = describe.skipIf(!flowTestsEnabled());

let flow: FlowApp;
let owner: AuthData;

describeFlow("Флоу B: сессия лаунчера", () => {
  beforeAll(async () => {
    flow = await bootFlowApp({ owner: OWNER });
    owner = flow.owner!;
  });

  afterAll(async () => {
    await flow?.cleanup();
  });

  it("B1: первый запуск — апдейтер без релизов, конфиг и список версий читаются", async () => {
    const latest = await api(flow.baseUrl).get("/v1/launcher/update/latest");
    expect(latest.status).toBe(404);

    const config = await api(flow.baseUrl).get("/v1/launcher/config");
    expect(config.status).toBe(200);
    const configBody = (await config.json()) as Record<string, unknown>;
    expect(configBody["projectName"]).toBeString();

    const versions = await api(flow.baseUrl).get("/v1/launcher/update/version");
    expect(versions.status).toBe(200);
    const versionsBody = (await versions.json()) as {
      version: string;
      platforms: unknown[];
      versions: { version: string; platforms: unknown[] }[];
    };
    expect(versionsBody.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Array.isArray(versionsBody.versions)).toBeTrue();
  });

  it("B2: регистрация из лаунчера — сессии нет до одобрения, повторная 409", async () => {
    const registration = await api(flow.baseUrl).post("/v1/common/auth/registration", {
      username: "flsa_newbie",
      password: "newbie-pass-1",
    });
    expect(registration.status).toBe(201);
    const body = (await registration.json()) as AuthData;
    expect(body.role).toBe("user");

    const login = await api(flow.baseUrl).post("/v1/common/auth/login", {
      username: "flsa_newbie",
      password: "newbie-pass-1",
    });
    expect(login.status).toBe(401);
    expect(((await login.json()) as { message: string }).message).toBe(
      "Неверное имя пользователя или пароль",
    );

    const again = await api(flow.baseUrl).post("/v1/common/auth/registration", {
      username: "flsa_newbie",
      password: "newbie-pass-1",
    });
    expect(again.status).toBe(409);
  });

  it("B3: вход — refresh сохранённого аккаунта, ротация и гонка; вход паролем", async () => {
    const player = await createApprovedPlayer(flow.baseUrl, owner, "flsa_saver", "saver-pass-1");

    const refreshed = await api(flow.baseUrl).post("/v1/common/auth/refresh", {
      refresh_token: player.tokens.refresh_token,
    });
    expect(refreshed.status).toBe(201);
    const refreshedBody = (await refreshed.json()) as AuthData;
    expect(refreshedBody.tokens.access_token).toBeString();
    expect(refreshedBody.username).toBe("flsa_saver");
    expect(refreshedBody.role).toBe("user");

    const oldRefresh = await api(flow.baseUrl).post("/v1/common/auth/refresh", {
      refresh_token: player.tokens.refresh_token,
    });
    expect(oldRefresh.status).toBe(401);

    const racer = await createApprovedPlayer(flow.baseUrl, owner, "flsa_racer", "racer-pass-1");
    const attempts = await Promise.all(
      Array.from({ length: 2 }, () =>
        api(flow.baseUrl).post("/v1/common/auth/refresh", {
          refresh_token: racer.tokens.refresh_token,
        }),
      ),
    );
    const statuses = attempts.map((response) => response.status);
    expect(statuses.filter((status) => status === 201).length).toBe(1);
    expect(statuses.filter((status) => status === 401).length).toBe(1);

    const login = await loginAndPasswordAssertions("flsa_racer", "racer-pass-1", "user");
    expect(login).toBeTrue();

    const wrong = await api(flow.baseUrl).post("/v1/common/auth/login", {
      username: "flsa_racer",
      password: "wrong-password",
    });
    expect(wrong.status).toBe(401);
    const missing = await api(flow.baseUrl).post("/v1/common/auth/login", {
      username: "no_such_user_flsa",
      password: "wrong-password",
    });
    expect(missing.status).toBe(401);
    const wrongBody = (await wrong.json()) as { message: string };
    const missingBody = (await missing.json()) as { message: string };
    expect(wrongBody.message).toBe(missingBody.message);
  });

  it("B4: смена пароля в лаунчере — новая пара, старые токены мертвы", async () => {
    const player = await createApprovedPlayer(flow.baseUrl, owner, "flsa_passer", "old-pass-123");
    const oldAccessToken = player.tokens.access_token;
    const oldRefreshToken = player.tokens.refresh_token;

    await Bun.sleep(1100);

    const changed = await api(flow.baseUrl).patch(
      "/v1/common/auth/password",
      { old_password: "old-pass-123", new_password: "new-pass-456" },
      oldAccessToken,
    );
    expect(changed.status).toBe(200);
    const changedBody = (await changed.json()) as AuthData;
    expect(changedBody.tokens.access_token).toBeString();
    expect(changedBody.tokens.refresh_token).toBeString();

    const oldRefresh = await api(flow.baseUrl).post("/v1/common/auth/refresh", {
      refresh_token: oldRefreshToken,
    });
    expect(oldRefresh.status).toBe(401);

    const oldAccess = await api(flow.baseUrl).get(
      `/v1/common/content/skins/${player.uuid}`,
      oldAccessToken,
    );
    expect(oldAccess.status).toBe(401);

    const oldLogin = await api(flow.baseUrl).post("/v1/common/auth/login", {
      username: "flsa_passer",
      password: "old-pass-123",
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await api(flow.baseUrl).post("/v1/common/auth/login", {
      username: "flsa_passer",
      password: "new-pass-456",
    });
    expect(newLogin.status).toBe(201);
  });

  it("B5: выход / удаление аккаунта — invalidate, идемпотентный повтор", async () => {
    const player = await createApprovedPlayer(flow.baseUrl, owner, "flsa_leaver", "leaver-pass-1");

    const invalidated = await api(flow.baseUrl).post("/v1/common/auth/invalidate", {
      refresh_token: player.tokens.refresh_token,
    });
    expect(invalidated.status).toBe(201);

    const refreshed = await api(flow.baseUrl).post("/v1/common/auth/refresh", {
      refresh_token: player.tokens.refresh_token,
    });
    expect(refreshed.status).toBe(401);

    const again = await api(flow.baseUrl).post("/v1/common/auth/invalidate", {
      refresh_token: player.tokens.refresh_token,
    });
    expect(again.status).toBe(201);

    const garbage = await api(flow.baseUrl).post("/v1/common/auth/invalidate", {
      refresh_token: "not-a-jwt",
    });
    expect(garbage.status).toBe(401);
  });

  async function loginAndPasswordAssertions(
    username: string,
    password: string,
    role: string,
  ): Promise<boolean> {
    const response = await api(flow.baseUrl).post("/v1/common/auth/login", { username, password });
    if (response.status !== 201) return false;
    const body = (await response.json()) as AuthData;
    return body.role === role && body.username === username && body.uuid.length > 0;
  }
});
