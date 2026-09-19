import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { CronService } from "../../cron/cron.service";
import { execute } from "../../utils/sql";
import {
  api,
  bootFlowApp,
  createApprovedPlayer,
  flowTestsEnabled,
  loginViaApi,
  type AuthData,
  type FlowApp,
} from "../../utils/tests/flow-postgres";
import { buildTestPng } from "../../utils/tests/test-png";

const OWNER = { username: "fdr-owner", password: "owner-pass-1" };

const describeFlow = describe.skipIf(!flowTestsEnabled());

let flow: FlowApp;
let owner: AuthData;

async function uploadSkin(player: AuthData): Promise<void> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buildTestPng({ variant: 5 }))], { type: "image/png" }),
    "skin.png",
  );
  const response = await fetch(`${flow.baseUrl}/v1/common/content/skins`, {
    method: "POST",
    headers: { authorization: `Bearer ${player.tokens.access_token}` },
    body: form,
  });
  expect(response.status).toBe(201);
}

describeFlow("Флоу E5: удаление и восстановление", () => {
  beforeAll(async () => {
    flow = await bootFlowApp({ owner: OWNER });
    owner = flow.owner!;
  });

  afterAll(async () => {
    await flow?.cleanup();
  });

  it("удалённый теряет доступ сквозь все слои, ник освобождается, restore конфликтует", async () => {
    const victim = await createApprovedPlayer(flow.baseUrl, owner, "fdr_victim", "victim-pass-1");
    await uploadSkin(victim);

    const deleted = await api(flow.baseUrl).del(
      `/v1/panel/users/${victim.username}`,
      owner.tokens.access_token,
    );
    expect(deleted.status).toBe(200);

    expect(await loginViaApi(flow.baseUrl, victim.username, "victim-pass-1")).toBeUndefined();
    const jwtAfterDelete = await api(flow.baseUrl).get(
      `/v1/common/content/skins/${victim.uuid}`,
      victim.tokens.access_token,
    );
    expect(jwtAfterDelete.status).toBe(401);
    const yggAfterDelete = await api(flow.baseUrl).post("/authserver/authenticate", {
      username: victim.username,
      password: "victim-pass-1",
    });
    expect(yggAfterDelete.status).toBe(403);

    const successor = await createApprovedPlayer(
      flow.baseUrl,
      owner,
      "fdr_victim",
      "successor-pass-1",
    );
    expect(successor.uuid).not.toBe(victim.uuid);

    const conflict = await api(flow.baseUrl).patch(
      `/v1/panel/users/${victim.username}/restore`,
      undefined,
      owner.tokens.access_token,
    );
    expect(conflict.status).toBe(409);

    const deletedPage = (await (
      await api(flow.baseUrl).get(
        "/v1/panel/users/deleted?username=fdr_victim",
        owner.tokens.access_token,
      )
    ).json()) as { items: { username: string }[]; total: number };
    expect(deletedPage.total).toBe(1);
    expect(deletedPage.items.map((item) => item.username)).toContain("fdr_victim");

    const successorDeleted = await api(flow.baseUrl).del(
      `/v1/panel/users/${successor.username}`,
      owner.tokens.access_token,
    );
    expect(successorDeleted.status).toBe(200);

    const restore = await api(flow.baseUrl).patch(
      `/v1/panel/users/${successor.username}/restore`,
      undefined,
      owner.tokens.access_token,
    );
    expect(restore.status).toBe(200);

    const restoredLogin = await loginViaApi(flow.baseUrl, successor.username, "successor-pass-1");
    expect(restoredLogin?.uuid).toBe(successor.uuid);
    expect(restoredLogin?.role).toBe("user");

    const afterRestore = (await (
      await api(flow.baseUrl).get(
        "/v1/panel/users/deleted?username=fdr_victim",
        owner.tokens.access_token,
      )
    ).json()) as { total: number };
    expect(afterRestore.total).toBe(0);
  });

  it("E6: cron-чистка вычищает строки старше retention и не трогает свежие", async () => {
    const aged = await createApprovedPlayer(flow.baseUrl, owner, "fdr_aged", "aged-pass-1");
    const fresh = await createApprovedPlayer(flow.baseUrl, owner, "fdr_fresh", "fresh-pass-1");

    await api(flow.baseUrl).del(`/v1/panel/users/${aged.username}`, owner.tokens.access_token);
    await api(flow.baseUrl).del(`/v1/panel/users/${fresh.username}`, owner.tokens.access_token);

    await execute(
      "UPDATE users SET deleted_at = CURRENT_TIMESTAMP - INTERVAL '40 days' WHERE username = $1",
      [aged.username],
    );

    await flow.app.get(CronService).runAll();

    const agedRestore = await api(flow.baseUrl).patch(
      `/v1/panel/users/${aged.username}/restore`,
      undefined,
      owner.tokens.access_token,
    );
    expect(agedRestore.status).toBe(404);
    const agedPage = (await (
      await api(flow.baseUrl).get(
        "/v1/panel/users/deleted?username=fdr_aged",
        owner.tokens.access_token,
      )
    ).json()) as { total: number };
    expect(agedPage.total).toBe(0);

    const freshRestore = await api(flow.baseUrl).patch(
      `/v1/panel/users/${fresh.username}/restore`,
      undefined,
      owner.tokens.access_token,
    );
    expect(freshRestore.status).toBe(200);
    expect(await loginViaApi(flow.baseUrl, fresh.username, "fresh-pass-1")).toBeObject();
  });
});
