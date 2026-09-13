import { describe, expect, it } from "bun:test";
import { MemoryDb } from "../../memory/memory-db";
import { YggdrasilMapSessionStore, YggdrasilMapTokenStore } from "../../memory/yggdrasil-map.store";
import { MAX_TOKENS_PER_USER, type TokenEntry } from "../service/yggdrasil_store";

const buildTokenEntry = (username: string, userId: string): TokenEntry => ({
  profileId: null,
  username,
  clientToken: "client-token",
  userId,
});

describe("YggdrasilMapTokenStore", () => {
  it("выдаёт токен после сохранения", async () => {
    const store = new YggdrasilMapTokenStore(new MemoryDb());

    await store.saveToken("token-1", buildTokenEntry("alice", "uuid-1"));

    expect(await store.findToken("token-1")).toEqual(buildTokenEntry("alice", "uuid-1"));
  });

  it("не выдаёт токен после истечения TTL и удаляет его", async () => {
    const db = new MemoryDb();
    const store = new YggdrasilMapTokenStore(db);

    await store.saveToken("token-1", buildTokenEntry("alice", "uuid-1"));
    const record = db.yggdrasilTokens.get("token-1");
    if (!record) throw new Error("токен не сохранён");
    record.expiresAt = Date.now() - 1;

    expect(await store.findToken("token-1")).toBeUndefined();
    expect(db.yggdrasilTokens.has("token-1")).toBe(false);
  });

  it("вытесняет самые старые токены пользователя при превышении лимита", async () => {
    const db = new MemoryDb();
    const store = new YggdrasilMapTokenStore(db);

    for (let i = 0; i <= MAX_TOKENS_PER_USER; i++) {
      await store.saveToken(`token-${i}`, buildTokenEntry("alice", "uuid-1"));
    }
    await store.saveToken("bob-token", buildTokenEntry("bob", "uuid-2"));

    expect(await store.findToken("token-0")).toBeUndefined();
    expect(await store.findToken("token-1")).toBeDefined();
    expect(await store.findToken(`token-${MAX_TOKENS_PER_USER}`)).toBeDefined();
    expect(await store.findToken("bob-token")).toBeDefined();
  });

  it("deleteTokensByUserId удаляет только токены пользователя", async () => {
    const store = new YggdrasilMapTokenStore(new MemoryDb());

    await store.saveToken("alice-token", buildTokenEntry("alice", "uuid-1"));
    await store.saveToken("bob-token", buildTokenEntry("bob", "uuid-2"));

    await store.deleteTokensByUserId("uuid-1");

    expect(await store.findToken("alice-token")).toBeUndefined();
    expect(await store.findToken("bob-token")).toBeDefined();
  });

  it("deleteToken удаляет конкретный токен", async () => {
    const store = new YggdrasilMapTokenStore(new MemoryDb());

    await store.saveToken("token-1", buildTokenEntry("alice", "uuid-1"));
    await store.deleteToken("token-1");

    expect(await store.findToken("token-1")).toBeUndefined();
  });

  it("claimToken возвращает запись и удаляет токен", async () => {
    const store = new YggdrasilMapTokenStore(new MemoryDb());

    await store.saveToken("token-1", buildTokenEntry("alice", "uuid-1"));

    const claimed = await store.claimToken("token-1");
    expect(claimed).toEqual(buildTokenEntry("alice", "uuid-1"));
    expect(await store.findToken("token-1")).toBeUndefined();
  });

  it("claimToken отсутствующего токена — undefined", async () => {
    const store = new YggdrasilMapTokenStore(new MemoryDb());

    expect(await store.claimToken("missing-token")).toBeUndefined();
  });

  it("чистит просроченные токены при выдаче нового", async () => {
    const db = new MemoryDb();
    const store = new YggdrasilMapTokenStore(db);

    await store.saveToken("stale-token", buildTokenEntry("alice", "uuid-1"));
    const record = db.yggdrasilTokens.get("stale-token");
    if (!record) throw new Error("токен не сохранён");
    record.expiresAt = Date.now() - 1;

    await store.saveToken("fresh-token", buildTokenEntry("bob", "uuid-2"));

    expect(db.yggdrasilTokens.has("stale-token")).toBe(false);
    expect(await store.findToken("fresh-token")).toBeDefined();
  });
});

describe("YggdrasilMapSessionStore", () => {
  it("выдаёт сессию после сохранения", async () => {
    const store = new YggdrasilMapSessionStore(new MemoryDb());
    const entry = { profileId: "profile-1", username: "alice" };

    await store.saveSession("server-1", entry);

    expect(await store.findSession("server-1")).toEqual(entry);
  });

  it("не выдаёт сессию после истечения TTL и удаляет её", async () => {
    const db = new MemoryDb();
    const store = new YggdrasilMapSessionStore(db);

    await store.saveSession("server-1", { profileId: "profile-1", username: "alice" });
    const record = db.yggdrasilSessions.get("server-1");
    if (!record) throw new Error("сессия не сохранена");
    record.expiresAt = Date.now() - 1;

    expect(await store.findSession("server-1")).toBeUndefined();
    expect(db.yggdrasilSessions.has("server-1")).toBe(false);
  });

  it("перезаписывает сессию с тем же serverId", async () => {
    const store = new YggdrasilMapSessionStore(new MemoryDb());

    await store.saveSession("server-1", { profileId: "profile-1", username: "alice" });
    await store.saveSession("server-1", { profileId: "profile-2", username: "bob" });

    expect(await store.findSession("server-1")).toEqual({
      profileId: "profile-2",
      username: "bob",
    });
  });

  it("чистит просроченные сессии при записи новой", async () => {
    const db = new MemoryDb();
    const store = new YggdrasilMapSessionStore(db);

    await store.saveSession("stale-server", { profileId: "profile-1", username: "alice" });
    const record = db.yggdrasilSessions.get("stale-server");
    if (!record) throw new Error("сессия не сохранена");
    record.expiresAt = Date.now() - 1;

    await store.saveSession("fresh-server", { profileId: "profile-2", username: "bob" });

    expect(db.yggdrasilSessions.has("stale-server")).toBe(false);
    expect(await store.findSession("fresh-server")).toBeDefined();
  });
});
