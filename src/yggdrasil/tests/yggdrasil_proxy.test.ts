import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { YggdrasilProxyStore } from "../service/yggdrasil_proxy";

const UPSTREAM_URL = "https://upstream.example.com";

const mockUpstreamProfile = {
  id: "a1b2c3d4e5f67890abcdef1234567890",
  name: "player1",
  properties: [
    {
      name: "textures",
      value: Buffer.from(
        JSON.stringify({
          textures: {
            SKIN: { url: "http://example.com/skin.png", metadata: { model: "slim" } },
            CAPE: { url: "http://example.com/cape.png" },
          },
        }),
      ).toString("base64"),
    },
  ],
};

const mockUpstreamAuthResponse = {
  accessToken: "upstream-access-token-abc123",
  clientToken: "upstream-client-token-xyz",
  availableProfiles: [mockUpstreamProfile],
  selectedProfile: mockUpstreamProfile,
  user: { id: mockUpstreamProfile.id, properties: [] },
};

let fetchMock: ReturnType<typeof mock>;
let proxyStore: YggdrasilProxyStore;

beforeEach(() => {
  fetchMock = mock(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      data: null as unknown,
      error: undefined,
    }),
  );

  mock.module("../../utils/fetch", () => ({
    limaFetch: fetchMock,
  }));

  proxyStore = new YggdrasilProxyStore(UPSTREAM_URL);
});

afterEach(() => {
  mock.restore();
});

describe("YggdrasilProxyStore", () => {
  describe("authenticateViaProxy", () => {
    it("делегирует authenticate на upstream", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: mockUpstreamAuthResponse,
        error: undefined,
      });

      const result = await proxyStore.authenticateViaProxy("player1", "pass123", "my-client-token");

      expect(fetchMock).toHaveBeenCalledWith(`${UPSTREAM_URL}/authserver/authenticate`, {
        method: "POST",
        body: {
          username: "player1",
          password: "pass123",
          clientToken: "my-client-token",
          requestUser: true,
        },
      });

      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe("upstream-access-token-abc123");
      expect(result!.clientToken).toBe("upstream-client-token-xyz");
      expect(result!.profiles).toHaveLength(1);
      expect(result!.profiles[0]!.uuid).toBe(mockUpstreamProfile.id);
      expect(result!.profiles[0]!.username).toBe("player1");
      expect(result!.profiles[0]!.skinUrl).toBe("http://example.com/skin.png");
      expect(result!.profiles[0]!.skinModel).toBe("slim");
      expect(result!.profiles[0]!.capeUrl).toBe("http://example.com/cape.png");
    });

    it("возвращает null при ошибке upstream", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        data: { errorMessage: "Invalid credentials." },
        error: "Invalid credentials.",
      });

      const result = await proxyStore.authenticateViaProxy("player1", "wrong");

      expect(result).toBeNull();
    });

    it("возвращает null при network error", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 0,
        data: null,
        error: "Request timeout",
      });

      const result = await proxyStore.authenticateViaProxy("player1", "pass");

      expect(result).toBeNull();
    });

    it("корректно маппит профили без selectedProfile", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          ...mockUpstreamAuthResponse,
          selectedProfile: undefined,
        },
        error: undefined,
      });

      const result = await proxyStore.authenticateViaProxy("player1", "pass");

      expect(result).not.toBeNull();
      expect(result!.selectedProfile).toBeUndefined();
    });
  });

  describe("refreshViaProxy", () => {
    it("делегирует refresh на upstream", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          accessToken: "new-upstream-token",
          clientToken: "new-client-token",
          selectedProfile: mockUpstreamProfile,
          user: { id: mockUpstreamProfile.id, properties: [] },
        },
        error: undefined,
      });

      const result = await proxyStore.refreshViaProxy("old-token", "client-1", undefined, true);

      expect(fetchMock).toHaveBeenCalledWith(`${UPSTREAM_URL}/authserver/refresh`, {
        method: "POST",
        body: {
          accessToken: "old-token",
          clientToken: "client-1",
          requestUser: true,
        },
      });

      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe("new-upstream-token");
      expect(result!.clientToken).toBe("new-client-token");
      expect(result!.selectedProfile).toBeDefined();
    });

    it("возвращает null при ошибке upstream", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        data: { errorMessage: "Invalid token." },
        error: "Invalid token.",
      });

      const result = await proxyStore.refreshViaProxy("bad-token");

      expect(result).toBeNull();
    });
  });

  describe("signoutViaProxy", () => {
    it("делегирует invalidate на upstream", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 204,
        data: null,
        error: undefined,
      });

      const result = await proxyStore.signoutViaProxy("player1", "pass123");

      expect(fetchMock).toHaveBeenCalledWith(`${UPSTREAM_URL}/authserver/invalidate`, {
        method: "POST",
        body: { username: "player1", password: "pass123" },
      });

      expect(result).toBe(true);
    });

    it("возвращает false при ошибке upstream", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        data: null,
        error: "Internal error",
      });

      const result = await proxyStore.signoutViaProxy("player1", "pass");

      expect(result).toBe(false);
    });
  });

  describe("findProfileByUuid", () => {
    it("запрашивает профиль у upstream", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: mockUpstreamProfile,
        error: undefined,
      });

      const profile = await proxyStore.findProfileByUuid(mockUpstreamProfile.id);

      expect(fetchMock).toHaveBeenCalledWith(
        `${UPSTREAM_URL}/sessionserver/session/minecraft/profile/${mockUpstreamProfile.id}`,
      );
      expect(profile).not.toBeUndefined();
      expect(profile!.uuid).toBe(mockUpstreamProfile.id);
      expect(profile!.username).toBe("player1");
    });

    it("возвращает undefined при ошибке upstream", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        data: null,
        error: "Not found",
      });

      const profile = await proxyStore.findProfileByUuid("nonexistent");

      expect(profile).toBeUndefined();
    });
  });

  describe("findProfileByUsername", () => {
    it("запрашивает профиль по username у upstream", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [mockUpstreamProfile],
        error: undefined,
      });

      const profile = await proxyStore.findProfileByUsername("player1");

      expect(fetchMock).toHaveBeenCalledWith(`${UPSTREAM_URL}/api/profiles/minecraft`, {
        method: "POST",
        body: ["player1"],
      });
      expect(profile).not.toBeUndefined();
      expect(profile!.username).toBe("player1");
    });

    it("возвращает undefined если upstream вернул пустой массив", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [],
        error: undefined,
      });

      const profile = await proxyStore.findProfileByUsername("nobody");

      expect(profile).toBeUndefined();
    });
  });

  describe("saveProfile", () => {
    it("сохраняет профиль локально", async () => {
      await proxyStore.saveProfile({
        uuid: "uuid-1",
        userId: "user-1",
        username: "player1",
      });

      const profile = await proxyStore.findProfileByUuid("uuid-1");
      expect(profile).toBeDefined();
    });
  });

  describe("findUserByUsername", () => {
    it("возвращает undefined — пользователи не хранятся локально", async () => {
      const user = await proxyStore.findUserByUsername("player1");
      expect(user).toBeUndefined();
    });
  });
});
