import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  api,
  bootFlowApp,
  createApprovedPlayer,
  flowTestsEnabled,
  type AuthData,
  type FlowApp,
} from "../../utils/tests/flow-postgres";

const OWNER = { username: "fgl-owner", password: "owner-pass-1" };
const FIXTURE_DIR = join(process.cwd(), "public", "launcher", "flow-fixtures");
const FIXTURE_MODS_DIR = join(process.cwd(), "public", "launcher", "mods");
const FILE_BODY = "flow-e2e asset";
const MOD_BODY = "flow-e2e mod";
const FIXTURE_KEY = "flow-fixtures/config.json";
const FIXTURE_MOD_KEY = "mods/flow-mod.jar";

const describeFlow = describe.skipIf(!flowTestsEnabled());

let flow: FlowApp;
let owner: AuthData;

describeFlow("Флоу C: игровая сессия", () => {
  beforeAll(async () => {
    flow = await bootFlowApp({ owner: OWNER });
    owner = flow.owner!;
    mkdirSync(FIXTURE_DIR, { recursive: true });
    mkdirSync(FIXTURE_MODS_DIR, { recursive: true });
    writeFileSync(join(FIXTURE_DIR, "config.json"), FILE_BODY);
    writeFileSync(join(FIXTURE_MODS_DIR, "flow-mod.jar"), MOD_BODY);
  });

  afterAll(async () => {
    rmSync(FIXTURE_DIR, { force: true, recursive: true });
    rmSync(join(FIXTURE_MODS_DIR, "flow-mod.jar"), { force: true });
    await flow?.cleanup();
  });

  it("C1: от логина в лаунчер до входа в мир — файлы, модели, join, hasJoined", async () => {
    const player = await createApprovedPlayer(flow.baseUrl, owner, "fgl_player", "player-pass-1");
    const token = player.tokens.access_token;

    await waitForFilesIndex(FIXTURE_KEY);
    const list = await api(flow.baseUrl).get("/v1/launcher/files/list", token);
    expect(list.status).toBe(200);
    const files = (await list.json()) as Record<string, string>;
    expect(Object.keys(files)).toContain(FIXTURE_KEY);
    expect(Object.keys(files).some((key) => key.includes("flow-mod.jar"))).toBeFalse();
    expect(list.headers.get("x-total-count")).toBeString();

    const downloaded = await api(flow.baseUrl).post(
      "/v1/launcher/files/download",
      { url: FIXTURE_KEY },
      token,
    );
    expect(downloaded.status).toBe(200);
    expect(await downloaded.text()).toBe(FILE_BODY);

    const mods = await api(flow.baseUrl).get("/v1/launcher/files/mods", token);
    expect(mods.status).toBe(200);
    const modsList = (await mods.json()) as Record<string, string>;
    expect(Object.keys(modsList)).toContain(FIXTURE_MOD_KEY);
    const modDownloaded = await api(flow.baseUrl).post(
      "/v1/launcher/files/download",
      { url: FIXTURE_MOD_KEY },
      token,
    );
    expect(modDownloaded.status).toBe(200);
    expect(await modDownloaded.text()).toBe(MOD_BODY);

    const models = await api(flow.baseUrl).get(`/v1/common/content/models/${player.uuid}`, token);
    expect(models.status).toBe(200);
    expect(await models.json()).toEqual([]);

    const metadata = await api(flow.baseUrl).get("/");
    expect(metadata.status).toBe(200);
    const metadataBody = (await metadata.json()) as { skinDomains: string[]; meta: unknown };
    expect(metadataBody.skinDomains).toContain("localhost");
    expect(metadataBody.meta).toBeObject();

    const serverId = "flow-server-id-1";
    const joinResponse = await api(flow.baseUrl).post("/sessionserver/session/minecraft/join", {
      accessToken: token,
      selectedProfile: player.uuid,
      serverId,
    });
    expect(joinResponse.status).toBe(204);

    const hasJoined = await api(flow.baseUrl).get(
      `/sessionserver/session/minecraft/hasJoined?username=${player.username}&serverId=${serverId}`,
    );
    expect(hasJoined.status).toBe(200);
    const profile = (await hasJoined.json()) as {
      id: string;
      name: string;
      properties: { name: string; value: string }[];
    };
    expect(profile.id).toBe(player.uuid);
    expect(profile.name).toBe(player.username);
    expect(Array.isArray(profile.properties)).toBeTrue();

    const stranger = await api(flow.baseUrl).get(
      `/sessionserver/session/minecraft/hasJoined?username=${player.username}&serverId=other-server`,
    );
    expect(stranger.status).toBe(204);

    const profileById = await api(flow.baseUrl).get(
      `/sessionserver/session/minecraft/profile/${player.uuid}`,
    );
    expect(profileById.status).toBe(200);
    expect(((await profileById.json()) as { id: string }).id).toBe(player.uuid);
  });

  it("C3: бан во время сессии — join отклоняется, после разбана снова работает", async () => {
    const player = await createApprovedPlayer(flow.baseUrl, owner, "fgl_banned", "banned-pass-1");
    const token = player.tokens.access_token;

    const joinBefore = await api(flow.baseUrl).post("/sessionserver/session/minecraft/join", {
      accessToken: token,
      selectedProfile: player.uuid,
      serverId: "flow-server-ban",
    });
    expect(joinBefore.status).toBe(204);

    try {
      const ban = await api(flow.baseUrl).patch(
        "/v1/panel/users/ban",
        { username: player.username, banned: true },
        owner.tokens.access_token,
      );
      expect(ban.status).toBe(200);

      const joinBanned = await api(flow.baseUrl).post("/sessionserver/session/minecraft/join", {
        accessToken: token,
        selectedProfile: player.uuid,
        serverId: "flow-server-ban-2",
      });
      expect(joinBanned.status).toBe(403);

      const v1Access = await api(flow.baseUrl).get(
        `/v1/common/content/skins/${player.uuid}`,
        token,
      );
      expect(v1Access.status).toBe(401);
    } finally {
      const unban = await api(flow.baseUrl).patch(
        "/v1/panel/users/ban",
        { username: player.username, banned: false },
        owner.tokens.access_token,
      );
      expect(unban.status).toBe(200);
    }

    const joinRestored = await api(flow.baseUrl).post("/sessionserver/session/minecraft/join", {
      accessToken: token,
      selectedProfile: player.uuid,
      serverId: "flow-server-ban-3",
    });
    expect(joinRestored.status).toBe(204);
  });

  it("C4: неодобренный и несуществующий игрок не могут джойниться (нейтральный отказ)", async () => {
    const unapproved = await api(flow.baseUrl).post("/v1/common/auth/registration", {
      username: "fgl_waiter",
      password: "waiter-pass-1",
    });
    expect(unapproved.status).toBe(201);
    const unapprovedBody = (await unapproved.json()) as AuthData;

    const joinUnapproved = await api(flow.baseUrl).post("/sessionserver/session/minecraft/join", {
      accessToken: unapprovedBody.tokens.access_token,
      selectedProfile: unapprovedBody.uuid,
      serverId: "flow-server-unapproved",
    });
    expect(joinUnapproved.status).toBe(403);

    const joinGarbage = await api(flow.baseUrl).post("/sessionserver/session/minecraft/join", {
      accessToken: "garbage-token",
      selectedProfile: "0".repeat(32),
      serverId: "flow-server-garbage",
    });
    expect(joinGarbage.status).toBe(403);
  });
});

async function waitForFilesIndex(key: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const response = await api(flow.baseUrl).get(
      "/v1/launcher/files/list",
      owner.tokens.access_token,
    );
    if (response.status === 200 && key in ((await response.json()) as Record<string, string>))
      return;
    await Bun.sleep(100);
  }
  throw new Error(`индекс файлов так и не увидел ${key}`);
}
