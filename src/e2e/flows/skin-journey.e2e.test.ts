import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  api,
  bootFlowApp,
  createApprovedPlayer,
  flowTestsEnabled,
  type AuthData,
  type FlowApp,
} from "../../utils/tests/flow-postgres";
import { buildTestPng } from "../../utils/tests/test-png";

const OWNER = { username: "fsk-owner", password: "owner-pass-1" };

const describeFlow = describe.skipIf(!flowTestsEnabled());

let flow: FlowApp;
let owner: AuthData;

interface SkinItem {
  id: number | null;
  url: string;
  model?: string | null;
  active?: boolean;
}

interface TextureProperty {
  name: string;
  value: string;
  signature?: string;
}

async function profileTextures(
  uuid: string,
): Promise<{ SKIN?: { url: string }; CAPE?: { url: string } }> {
  const response = await api(flow.baseUrl).get(`/sessionserver/session/minecraft/profile/${uuid}`);
  expect(response.status).toBe(200);
  const profile = (await response.json()) as { properties: TextureProperty[] };
  const textures = profile.properties.find((property) => property.name === "textures");
  if (!textures) return {};
  const decoded = JSON.parse(Buffer.from(textures.value, "base64").toString("utf-8")) as {
    textures?: { SKIN?: { url: string }; CAPE?: { url: string } };
  };
  return decoded.textures ?? {};
}

async function fetchTexture(url: string): Promise<Response> {
  const path = new URL(url).pathname;
  return api(flow.baseUrl).get(path);
}

describeFlow("Флоу C2: скин от загрузки в лаунчере до игры", () => {
  beforeAll(async () => {
    flow = await bootFlowApp({ owner: OWNER, env: { MAX_SKINS_PER_USER: "2" } });
    owner = flow.owner!;
  });

  afterAll(async () => {
    await flow?.cleanup();
  });

  it("загрузка → активация → текстура в профиле → удаление с фолбэком на default", async () => {
    const player = await createApprovedPlayer(flow.baseUrl, owner, "fsk_player", "player-pass-1");
    const token = player.tokens.access_token;

    const initialList = await api(flow.baseUrl).get(
      `/v1/common/content/skins/${player.uuid}`,
      token,
    );
    expect(initialList.status).toBe(200);
    const initialSkins = (await initialList.json()) as SkinItem[];
    expect(
      initialSkins.some((skin) => skin.id === null && skin.url.includes("default.png")),
    ).toBeTrue();

    const skinA = buildTestPng({ width: 64, height: 64, variant: 1 });
    const uploadA = await uploadSkin(token, skinA, "classic");
    expect(uploadA.status).toBe(201);
    const skinAItem = (await uploadA.json()) as { id: number; url: string };

    const skinB = buildTestPng({ width: 64, height: 64, variant: 2 });
    const uploadB = await uploadSkin(token, skinB, "slim");
    expect(uploadB.status).toBe(201);
    const skinBItem = (await uploadB.json()) as { id: number; url: string };

    const list = await api(flow.baseUrl).get(`/v1/common/content/skins/${player.uuid}`, token);
    const skins = (await list.json()) as SkinItem[];
    expect(skins.length).toBe(2);
    expect(skins.map((skin) => skin.model)).toContain("slim");

    const activated = await api(flow.baseUrl).patch(
      "/v1/common/content/skins/active",
      { id: skinAItem.id },
      token,
    );
    expect(activated.status).toBe(200);

    const profileSkin = await profileTextures(player.uuid);
    expect(profileSkin.SKIN?.url).toBe(skinAItem.url);

    const textureFile = await fetchTexture(skinAItem.url);
    expect(textureFile.status).toBe(200);
    expect(new Uint8Array(await textureFile.arrayBuffer())).toEqual(new Uint8Array(skinA));

    const deleteA = await api(flow.baseUrl).del(`/v1/common/content/skins/${skinAItem.id}`, token);
    expect(deleteA.status).toBe(200);
    const afterDelete = await profileTextures(player.uuid);
    expect(afterDelete.SKIN?.url).toBe(skinBItem.url);

    const deleteB = await api(flow.baseUrl).del(`/v1/common/content/skins/${skinBItem.id}`, token);
    expect(deleteB.status).toBe(200);
    const finalList = await api(flow.baseUrl).get(`/v1/common/content/skins/${player.uuid}`, token);
    const finalSkins = (await finalList.json()) as SkinItem[];
    expect(finalSkins.length).toBe(1);
    expect(finalSkins[0]?.id).toBeNull();
    const finalProfile = await profileTextures(player.uuid);
    expect(finalProfile.SKIN?.url).toContain("default.png");

    const deleteDefault = await api(flow.baseUrl).del("/v1/common/content/skins/null", token);
    expect(deleteDefault.status).toBe(400);
    const activateDefault = await api(flow.baseUrl).patch(
      "/v1/common/content/skins/active",
      { id: null },
      token,
    );
    expect(activateDefault.status).toBe(400);
  });

  it("чужой контент недоступен: списки/удаление/активация под чужим uuid", async () => {
    const alice = await createApprovedPlayer(flow.baseUrl, owner, "fsk_alice", "alice-pass-1");
    const bob = await createApprovedPlayer(flow.baseUrl, owner, "fsk_bob", "bob-pass-1");

    const uploaded = await uploadSkin(
      alice.tokens.access_token,
      buildTestPng({ variant: 3 }),
      "classic",
    );
    expect(uploaded.status).toBe(201);
    const item = (await uploaded.json()) as { id: number };

    const bobToken = bob.tokens.access_token;
    const foreignList = await api(flow.baseUrl).get(
      `/v1/common/content/skins/${bob.uuid}`,
      alice.tokens.access_token,
    );
    expect(foreignList.status).toBe(200);

    const foreignDelete = await api(flow.baseUrl).del(
      `/v1/common/content/skins/${item.id}`,
      bobToken,
    );
    expect(foreignDelete.status).toBe(403);

    const foreignActivate = await api(flow.baseUrl).patch(
      "/v1/common/content/skins/active",
      { id: item.id },
      bobToken,
    );
    expect(foreignActivate.status).toBe(403);
  });

  it("битый PNG и невалидная модель отклоняются, CPM-модель загружается и удаляется", async () => {
    const player = await createApprovedPlayer(flow.baseUrl, owner, "fsk_model", "model-pass-1");
    const token = player.tokens.access_token;

    const brokenPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
    const broken = await uploadSkin(token, brokenPng, "classic");
    expect(broken.status).toBe(400);

    const badModel = await uploadSkin(token, buildTestPng({ variant: 4 }), "heroic");
    expect(badModel.status).toBe(400);

    const modelForm = new FormData();
    modelForm.append("file", new Blob(["player model data"], { type: "text/plain" }), "model.txt");
    const modelUpload = await fetch(`${flow.baseUrl}/v1/common/content/models`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: modelForm,
    });
    expect(modelUpload.status).toBe(201);
    const modelItem = (await modelUpload.json()) as { id: number; url: string };
    expect(modelItem.url).toContain("/models/");

    const modelsList = await api(flow.baseUrl).get(
      `/v1/common/content/models/${player.uuid}`,
      token,
    );
    expect(modelsList.status).toBe(200);
    expect(((await modelsList.json()) as { id: number }[]).map((model) => model.id)).toContain(
      modelItem.id,
    );

    const modelDelete = await api(flow.baseUrl).del(
      `/v1/common/content/models/${modelItem.id}`,
      token,
    );
    expect(modelDelete.status).toBe(200);
  });
});

function uploadSkin(token: string, png: Uint8Array, model: string): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "skin.png");
  return fetch(`${flow.baseUrl}/v1/common/content/skins?model=${model}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
}
