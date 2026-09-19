import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  api,
  bootFlowApp,
  createApprovedPlayer,
  flowTestsEnabled,
  type AuthData,
  type FlowApp,
} from "../../utils/tests/flow-postgres";

const OWNER = { username: "fyg-owner", password: "owner-pass-1" };
const INVALID_CREDENTIALS = "Invalid credentials. Invalid username or password.";

const describeFlow = describe.skipIf(!flowTestsEnabled());

let flow: FlowApp;
let owner: AuthData;

interface AuthenticateResponse {
  accessToken: string;
  clientToken: string;
  selectedProfile: { id: string; name: string };
  availableProfiles?: { id: string; name: string }[];
}

describeFlow("Флоу D: классический Yggdrasil", () => {
  beforeAll(async () => {
    flow = await bootFlowApp({ owner: OWNER });
    owner = flow.owner!;
  });

  afterAll(async () => {
    await flow?.cleanup();
  });

  it("D1: authenticate → validate → join → hasJoined → refresh → invalidate → signout", async () => {
    const player = await createApprovedPlayer(flow.baseUrl, owner, "fyg_player", "player-pass-1");

    const authenticated = await api(flow.baseUrl).post("/authserver/authenticate", {
      agent: { name: "Minecraft", version: 1 },
      username: player.username,
      password: "player-pass-1",
      clientToken: "flow-client-token",
      requestUser: true,
    });
    expect(authenticated.status).toBe(200);
    const auth = (await authenticated.json()) as AuthenticateResponse;
    expect(auth.clientToken).toBe("flow-client-token");
    expect(auth.selectedProfile.id).toBe(player.uuid);
    expect(auth.selectedProfile.name).toBe(player.username);

    const validated = await api(flow.baseUrl).post("/authserver/validate", {
      accessToken: auth.accessToken,
      clientToken: auth.clientToken,
    });
    expect(validated.status).toBe(204);

    const joined = await api(flow.baseUrl).post("/sessionserver/session/minecraft/join", {
      accessToken: auth.accessToken,
      selectedProfile: auth.selectedProfile.id,
      serverId: "fyg-server-1",
    });
    expect(joined.status).toBe(204);
    const hasJoined = await api(flow.baseUrl).get(
      `/sessionserver/session/minecraft/hasJoined?username=${player.username}&serverId=fyg-server-1`,
    );
    expect(hasJoined.status).toBe(200);

    const refreshed = await api(flow.baseUrl).post("/authserver/refresh", {
      accessToken: auth.accessToken,
      clientToken: auth.clientToken,
      requestUser: true,
    });
    expect(refreshed.status).toBe(200);
    const refreshedBody = (await refreshed.json()) as AuthenticateResponse;
    expect(refreshedBody.clientToken).toBe("flow-client-token");
    expect(refreshedBody.accessToken).not.toBe(auth.accessToken);

    const oldValidated = await api(flow.baseUrl).post("/authserver/validate", {
      accessToken: auth.accessToken,
    });
    expect(oldValidated.status).toBe(403);
    const newValidated = await api(flow.baseUrl).post("/authserver/validate", {
      accessToken: refreshedBody.accessToken,
    });
    expect(newValidated.status).toBe(204);

    const wrongClientInvalidate = await api(flow.baseUrl).post("/authserver/invalidate", {
      accessToken: refreshedBody.accessToken,
      clientToken: "another-client-token",
    });
    expect(wrongClientInvalidate.status).toBe(403);
    const stillValid = await api(flow.baseUrl).post("/authserver/validate", {
      accessToken: refreshedBody.accessToken,
    });
    expect(stillValid.status).toBe(204);

    const invalidated = await api(flow.baseUrl).post("/authserver/invalidate", {
      accessToken: refreshedBody.accessToken,
      clientToken: "flow-client-token",
    });
    expect(invalidated.status).toBe(204);
    const gone = await api(flow.baseUrl).post("/authserver/validate", {
      accessToken: refreshedBody.accessToken,
    });
    expect(gone.status).toBe(403);

    const signout = await api(flow.baseUrl).post("/authserver/signout", {
      username: player.username,
      password: "player-pass-1",
    });
    expect(signout.status).toBe(204);

    const reauth = await api(flow.baseUrl).post("/authserver/authenticate", {
      username: player.username,
      password: "player-pass-1",
    });
    expect(reauth.status).toBe(200);
  });

  it("D2: бан сквозь протокол — authenticate неотличим от неверного пароля", async () => {
    const player = await createApprovedPlayer(flow.baseUrl, owner, "fyg_banned", "banned-pass-1");

    const authenticated = await api(flow.baseUrl).post("/authserver/authenticate", {
      username: player.username,
      password: "banned-pass-1",
      clientToken: "fyg-ban-client",
    });
    expect(authenticated.status).toBe(200);
    const auth = (await authenticated.json()) as AuthenticateResponse;

    const wrongPassword = await api(flow.baseUrl).post("/authserver/authenticate", {
      username: player.username,
      password: "totally-wrong",
    });
    expect(wrongPassword.status).toBe(403);
    const wrongBody = (await wrongPassword.json()) as { error: string; errorMessage: string };

    try {
      const ban = await api(flow.baseUrl).patch(
        "/v1/panel/users/ban",
        { username: player.username, banned: true },
        owner.tokens.access_token,
      );
      expect(ban.status).toBe(200);

      const bannedAuth = await api(flow.baseUrl).post("/authserver/authenticate", {
        username: player.username,
        password: "banned-pass-1",
      });
      expect(bannedAuth.status).toBe(403);
      expect(await bannedAuth.json()).toEqual(wrongBody);
      expect(wrongBody.errorMessage).toBe(INVALID_CREDENTIALS);

      const bannedValidate = await api(flow.baseUrl).post("/authserver/validate", {
        accessToken: auth.accessToken,
      });
      expect(bannedValidate.status).toBe(403);
      const bannedJoin = await api(flow.baseUrl).post("/sessionserver/session/minecraft/join", {
        accessToken: auth.accessToken,
        selectedProfile: auth.selectedProfile.id,
        serverId: "fyg-banned-server",
      });
      expect(bannedJoin.status).toBe(403);
    } finally {
      const unban = await api(flow.baseUrl).patch(
        "/v1/panel/users/ban",
        { username: player.username, banned: false },
        owner.tokens.access_token,
      );
      expect(unban.status).toBe(200);
    }

    const restoredValidate = await api(flow.baseUrl).post("/authserver/validate", {
      accessToken: auth.accessToken,
    });
    expect(restoredValidate.status).toBe(204);
    const restoredJoin = await api(flow.baseUrl).post("/sessionserver/session/minecraft/join", {
      accessToken: auth.accessToken,
      selectedProfile: auth.selectedProfile.id,
      serverId: "fyg-restored-server",
    });
    expect(restoredJoin.status).toBe(204);
  });
});
