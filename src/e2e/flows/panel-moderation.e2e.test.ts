import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  api,
  bootFlowApp,
  createApprovedPlayer,
  flowTestsEnabled,
  loginViaApi,
  type AuthData,
  type FlowApp,
} from "../../utils/tests/flow-postgres";

const OWNER = { username: "fpm-owner", password: "owner-pass-1" };

const describeFlow = describe.skipIf(!flowTestsEnabled());

let flow: FlowApp;
let owner: AuthData;

interface UsersPage {
  items: { username: string; role: string; approved: boolean }[];
  total: number;
  limit: number;
  offset: number;
}

async function registerUser(username: string, password: string): Promise<AuthData> {
  const registration = await api(flow.baseUrl).post("/v1/common/auth/registration", {
    username,
    password,
  });
  expect(registration.status).toBe(201);
  return (await registration.json()) as AuthData;
}

async function setRole(actor: AuthData, username: string, role: string): Promise<Response> {
  return api(flow.baseUrl).patch(
    "/v1/panel/users/role",
    { username, role },
    actor.tokens.access_token,
  );
}

describeFlow("Флоу E: панель — модерация", () => {
  beforeAll(async () => {
    flow = await bootFlowApp({ owner: OWNER });
    owner = flow.owner!;
  });

  afterAll(async () => {
    await flow?.cleanup();
  });

  it("E1: неодобренные видны в панели, approve открывает вход", async () => {
    await registerUser("fpm_newbie1", "newbie-pass-1");
    await registerUser("fpm_newbie2", "newbie-pass-1");

    const unapproved = await api(flow.baseUrl).get(
      "/v1/panel/users?limit=10&offset=0&approved=false",
      owner.tokens.access_token,
    );
    expect(unapproved.status).toBe(200);
    const unapprovedPage = (await unapproved.json()) as UsersPage;
    expect(unapprovedPage.limit).toBe(10);
    expect(unapprovedPage.offset).toBe(0);
    const names = unapprovedPage.items.map((item) => item.username);
    expect(names).toContain("fpm_newbie1");
    expect(names).toContain("fpm_newbie2");

    const approved = await api(flow.baseUrl).patch(
      "/v1/panel/users/approve",
      { username: "fpm_newbie1", approved: true },
      owner.tokens.access_token,
    );
    expect(approved.status).toBe(200);

    const approvedPage = (await (
      await api(flow.baseUrl).get(
        "/v1/panel/users?limit=100&approved=true",
        owner.tokens.access_token,
      )
    ).json()) as UsersPage;
    expect(approvedPage.items.map((item) => item.username)).toContain("fpm_newbie1");
    expect(approvedPage.items.map((item) => item.username)).not.toContain("fpm_newbie2");

    expect(await loginViaApi(flow.baseUrl, "fpm_newbie1", "newbie-pass-1")).toBeObject();
    expect(await loginViaApi(flow.baseUrl, "fpm_newbie2", "newbie-pass-1")).toBeUndefined();

    const search = await api(flow.baseUrl).get(
      "/v1/panel/users?username=fpm_newbie",
      owner.tokens.access_token,
    );
    const searchPage = (await search.json()) as UsersPage;
    expect(searchPage.total).toBeGreaterThanOrEqual(2);
  });

  it("E2: иерархия ролей — user/moderator/admin/owner, второй овнер", async () => {
    const plain = await createApprovedPlayer(flow.baseUrl, owner, "fpm_plain", "plain-pass-1");
    const moderator = await createApprovedPlayer(flow.baseUrl, owner, "fpm_mod", "mod-pass-1");
    expect((await setRole(owner, moderator.username, "moderator")).status).toBe(200);
    const admin = await createApprovedPlayer(flow.baseUrl, owner, "fpm_admin", "admin-pass-1");
    expect((await setRole(owner, admin.username, "admin")).status).toBe(200);
    const newcomer = await registerUser("fpm_target", "target-pass-1");

    const userView = await api(flow.baseUrl).get("/v1/panel/users", plain.tokens.access_token);
    expect(userView.status).toBe(403);

    const modView = await api(flow.baseUrl).get("/v1/panel/users", moderator.tokens.access_token);
    expect(modView.status).toBe(403);
    const modApprove = await api(flow.baseUrl).patch(
      "/v1/panel/users/approve",
      { username: newcomer.username, approved: true },
      moderator.tokens.access_token,
    );
    expect(modApprove.status).toBe(403);
    const modGrantAdmin = await setRole(moderator, plain.username, "admin");
    expect(modGrantAdmin.status).toBe(403);

    const adminBan = await api(flow.baseUrl).patch(
      "/v1/panel/users/ban",
      { username: moderator.username, banned: true },
      admin.tokens.access_token,
    );
    expect(adminBan.status).toBe(200);
    const adminUnban = await api(flow.baseUrl).patch(
      "/v1/panel/users/ban",
      { username: moderator.username, banned: false },
      admin.tokens.access_token,
    );
    expect(adminUnban.status).toBe(200);

    const adminGrantAdmin = await setRole(admin, plain.username, "admin");
    expect(adminGrantAdmin.status).toBe(403);
    const adminTouchOwner = await api(flow.baseUrl).patch(
      "/v1/panel/users/ban",
      { username: owner.username, banned: true },
      admin.tokens.access_token,
    );
    expect(adminTouchOwner.status).toBe(403);
    const adminGrantOwner = await api(flow.baseUrl).patch(
      "/v1/panel/users/owner",
      { username: admin.username },
      admin.tokens.access_token,
    );
    expect(adminGrantOwner.status).toBe(403);
    const adminDeleted = await api(flow.baseUrl).get(
      "/v1/panel/users/deleted",
      admin.tokens.access_token,
    );
    expect(adminDeleted.status).toBe(403);

    const grantOwnerViaRole = await setRole(owner, plain.username, "owner");
    expect(grantOwnerViaRole.status).toBe(400);

    const promoted = await api(flow.baseUrl).patch(
      "/v1/panel/users/owner",
      { username: plain.username },
      owner.tokens.access_token,
    );
    expect(promoted.status).toBe(200);

    const secondOwnerDeleted = await api(flow.baseUrl).get(
      "/v1/panel/users/deleted?limit=10&offset=0",
      plain.tokens.access_token,
    );
    expect(secondOwnerDeleted.status).toBe(200);
    const secondOwnerRebuild = await api(flow.baseUrl).get(
      "/v1/panel/server/rebuild",
      plain.tokens.access_token,
    );
    expect(secondOwnerRebuild.status).toBe(200);

    expect((await loginViaApi(flow.baseUrl, owner.username, OWNER.password))?.role).toBe("owner");
  });

  it("E3: овнер сбрасывает пароль — все токены цели отзываются", async () => {
    const target = await createApprovedPlayer(flow.baseUrl, owner, "fpm_reset", "reset-pass-1");
    const oldAccess = target.tokens.access_token;
    const oldRefresh = target.tokens.refresh_token;

    await Bun.sleep(1100);

    const reset = await api(flow.baseUrl).patch(
      "/v1/panel/users/password",
      { username: target.username, password: "brand-new-pass" },
      owner.tokens.access_token,
    );
    expect(reset.status).toBe(200);

    const oldRefreshAttempt = await api(flow.baseUrl).post("/v1/common/auth/refresh", {
      refresh_token: oldRefresh,
    });
    expect(oldRefreshAttempt.status).toBe(401);
    const oldAccessAttempt = await api(flow.baseUrl).get(
      `/v1/common/content/skins/${target.uuid}`,
      oldAccess,
    );
    expect(oldAccessAttempt.status).toBe(401);
    expect(await loginViaApi(flow.baseUrl, target.username, "reset-pass-1")).toBeUndefined();

    const newLogin = await loginViaApi(flow.baseUrl, target.username, "brand-new-pass");
    expect(newLogin).toBeObject();
  });

  it("E4: логи — dates перед logs, контракт страницы, фильтры на пустой день", async () => {
    const dates = await api(flow.baseUrl).get("/v1/panel/logs/dates", owner.tokens.access_token);
    expect(dates.status).toBe(200);
    const datesBody = (await dates.json()) as string[];
    const today = new Date().toISOString().slice(0, 10);
    expect(datesBody).toContain(today);

    const empty = await api(flow.baseUrl).get(
      "/v1/panel/logs?date=2000-01-01&offset=0&limit=100",
      owner.tokens.access_token,
    );
    expect(empty.status).toBe(200);
    const emptyPage = (await empty.json()) as {
      date: string;
      offset: number;
      limit: number;
      total: number;
      lines: string[];
    };
    expect(emptyPage.date).toBe("2000-01-01");
    expect(emptyPage.total).toBe(0);
    expect(emptyPage.lines).toEqual([]);

    const filtered = await api(flow.baseUrl).get(
      "/v1/panel/logs?date=2000-01-01&statusCode=500&url=nothing&ip=1.2.3.4",
      owner.tokens.access_token,
    );
    expect(filtered.status).toBe(200);
    expect(((await filtered.json()) as { total: number }).total).toBe(0);

    const badDate = await api(flow.baseUrl).get(
      "/v1/panel/logs?date=not-a-date",
      owner.tokens.access_token,
    );
    expect(badDate.status).toBe(400);
  });
});
