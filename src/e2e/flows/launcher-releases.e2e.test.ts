import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  api,
  bootFlowApp,
  flowTestsEnabled,
  type AuthData,
  type FlowApp,
} from "../../utils/tests/flow-postgres";

const OWNER = { username: "flr-owner", password: "owner-pass-1" };
const WINDOWS_ARTIFACT = "windows-updater-binary";
const LINUX_ARTIFACT = "linux-updater-binary";
const WINDOWS_SIGNATURE = "windows-minisign-signature";
const LINUX_SIGNATURE = "linux-minisign-signature";
const ZIP_V2 = "launcher-zip-2.0.0-payload";
const ZIP_V21 = "launcher-zip-2.1.0-payload";

const describeFlow = describe.skipIf(!flowTestsEnabled());

let flow: FlowApp;
let owner: AuthData;

interface LatestRelease {
  version: string;
  pub_date?: string;
  platforms: Record<string, { url: string; signature: string }>;
}

function releaseForm(version: string, platforms: [string, string, string][]): FormData {
  const form = new FormData();
  form.append("version", version);
  for (const [key, artifact, signature] of platforms) {
    const extension = key.startsWith("windows") ? "exe" : "AppImage";
    form.append(key, new Blob([artifact]), `Limacina-${version}-${key}.${extension}`);
    form.append(`${key}_sig`, new Blob([signature]), `${key}.sig`);
  }
  return form;
}

async function fetchArtifact(url: string): Promise<Response> {
  return api(flow.baseUrl).get(new URL(url).pathname);
}

async function waitForVersion(version: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const response = await api(flow.baseUrl).get("/v1/launcher/update/version");
    if (
      response.status === 200 &&
      ((await response.json()) as { version: string }).version === version
    ) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(`version.json так и не обновился до ${version}`);
}

async function waitForConfig(projectName: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const response = await api(flow.baseUrl).get("/v1/launcher/config");
    if (response.status === 200) {
      const body = (await response.json()) as Record<string, unknown>;
      if (body["projectName"] === projectName) return;
    }
    await Bun.sleep(100);
  }
  throw new Error(`конфиг с projectName=${projectName} так и не подхватился вотчером`);
}

describeFlow("Флоу F: релизы и файлы лаунчера", () => {
  beforeAll(async () => {
    flow = await bootFlowApp({
      owner: OWNER,
      moveAside: ["config.toml", "public/version.json", "public/releases"],
    });
    owner = flow.owner!;
  });

  afterAll(async () => {
    await flow?.cleanup();
  });

  it("F1: публикация релиза по платформам → latest.json → статика → откат", async () => {
    const emptyLatest = await api(flow.baseUrl).get("/v1/launcher/update/latest");
    expect(emptyLatest.status).toBe(404);
    const emptyReleases = await api(flow.baseUrl).get("/v1/launcher/update/releases");
    expect(emptyReleases.status).toBe(200);
    expect(await emptyReleases.json()).toEqual({ releases: [] });

    const first = await api(flow.baseUrl).patchForm(
      "/v1/panel/launcher/release",
      releaseForm("1.0.0", [["windows-x86_64", WINDOWS_ARTIFACT, WINDOWS_SIGNATURE]]),
      owner.tokens.access_token,
    );
    expect(first.status).toBe(200);

    const latest = await api(flow.baseUrl).get("/v1/launcher/update/latest");
    expect(latest.status).toBe(200);
    const latestBody = (await latest.json()) as LatestRelease;
    expect(latestBody.version).toBe("1.0.0");
    const windowsRelease = latestBody.platforms["windows-x86_64"];
    expect(windowsRelease?.url).toContain("/releases/1.0.0/Limacina-1.0.0-windows-x86_64");
    expect(windowsRelease?.signature).toBe(WINDOWS_SIGNATURE);
    const artifact = await fetchArtifact(windowsRelease!.url);
    expect(artifact.status).toBe(200);
    expect(await artifact.text()).toBe(WINDOWS_ARTIFACT);

    const incremental = await api(flow.baseUrl).patchForm(
      "/v1/panel/launcher/release",
      releaseForm("1.0.0", [["linux-x86_64", LINUX_ARTIFACT, LINUX_SIGNATURE]]),
      owner.tokens.access_token,
    );
    expect(incremental.status).toBe(200);
    const bothPlatforms = (await (
      await api(flow.baseUrl).get("/v1/launcher/update/latest")
    ).json()) as LatestRelease;
    expect(Object.keys(bothPlatforms.platforms).toSorted()).toEqual([
      "linux-x86_64",
      "windows-x86_64",
    ]);

    const next = await api(flow.baseUrl).patchForm(
      "/v1/panel/launcher/release",
      releaseForm("1.1.0", [["windows-x86_64", WINDOWS_ARTIFACT, WINDOWS_SIGNATURE]]),
      owner.tokens.access_token,
    );
    expect(next.status).toBe(200);
    const currentLatest = (await (
      await api(flow.baseUrl).get("/v1/launcher/update/latest")
    ).json()) as LatestRelease;
    expect(currentLatest.version).toBe("1.1.0");

    const releases = (await (
      await api(flow.baseUrl).get("/v1/launcher/update/releases")
    ).json()) as { releases: { version: string }[] };
    expect(releases.releases.map((entry) => entry.version)).toEqual(["1.1.0", "1.0.0"]);

    const rollback = (await (
      await api(flow.baseUrl).get("/v1/launcher/update/latest?version=1.0.0")
    ).json()) as LatestRelease;
    expect(rollback.version).toBe("1.0.0");
    expect(Object.keys(rollback.platforms).length).toBe(2);

    const missingRollback = await api(flow.baseUrl).get("/v1/launcher/update/latest?version=9.9.9");
    expect(missingRollback.status).toBe(404);
  });

  it("F2: zip-протокол — публикация версии, скачивание текущей и архивной", async () => {
    const beforePublish = await api(flow.baseUrl).get("/v1/launcher/update/version");
    expect(beforePublish.status).toBe(200);
    expect(((await beforePublish.json()) as { version: string }).version).toBe("0.0.0");

    const published = await api(flow.baseUrl).patchForm(
      "/v1/panel/launcher",
      publishZipForm("2.0.0", ZIP_V2),
      owner.tokens.access_token,
    );
    expect(published.status).toBe(200);
    await waitForVersion("2.0.0");

    const versions = (await (
      await api(flow.baseUrl).get("/v1/launcher/update/version")
    ).json()) as { version: string; versions: { version: string }[] };
    expect(versions.version).toBe("2.0.0");
    expect(versions.versions.map((entry) => entry.version)).toContain("2.0.0");

    const download = await api(flow.baseUrl).get("/v1/launcher/update/linux/x86_64/download");
    expect(download.status).toBe(200);
    expect(download.headers.get("content-length")).toBe(String(ZIP_V2.length));
    expect(await download.text()).toBe(ZIP_V2);

    const publishedNext = await api(flow.baseUrl).patchForm(
      "/v1/panel/launcher",
      publishZipForm("2.1.0", ZIP_V21),
      owner.tokens.access_token,
    );
    expect(publishedNext.status).toBe(200);
    await waitForVersion("2.1.0");

    const current = await api(flow.baseUrl).get("/v1/launcher/update/linux/x86_64/download");
    expect(await current.text()).toBe(ZIP_V21);
    const archived = await api(flow.baseUrl).get(
      "/v1/launcher/update/linux/x86_64/download?version=2.0.0",
    );
    expect(archived.status).toBe(200);
    expect(await archived.text()).toBe(ZIP_V2);

    const badPlatform = await api(flow.baseUrl).get("/v1/launcher/update/solaris/sparc/download");
    expect(badPlatform.status).toBe(400);
    const missingVersion = await api(flow.baseUrl).get(
      "/v1/launcher/update/linux/x86_64/download?version=3.3.3",
    );
    expect(missingVersion.status).toBe(404);
  });

  it("F3: конфиг лаунчера — 404 до первой записи, PATCH создаёт и обновляет", async () => {
    const missing = await api(flow.baseUrl).get("/v1/launcher/config");
    expect(missing.status).toBe(404);

    const created = await api(flow.baseUrl).patch(
      "/v1/panel/launcher/config",
      {
        projectName: "Flow Project",
        mcVersion: "1.21.1",
        modLoader: "neoforge",
        loaderVersion: "21.1.234",
        jvmArgs: ["-XX:+UseG1GC"],
        minMemory: "-Xms512M",
        maxMemory: "-Xmx2560M",
        online: true,
      },
      owner.tokens.access_token,
    );
    expect(created.status).toBe(200);

    await waitForConfig("Flow Project");

    const config = await api(flow.baseUrl).get("/v1/launcher/config");
    expect(config.status).toBe(200);
    expect((await config.json()) as Record<string, unknown>).toMatchObject({
      projectName: "Flow Project",
      mcVersion: "1.21.1",
      online: true,
    });

    const updated = await api(flow.baseUrl).patch(
      "/v1/panel/launcher/config",
      {
        projectName: "Flow Project 2",
        mcVersion: "1.21.1",
        modLoader: "neoforge",
        loaderVersion: "21.1.234",
        jvmArgs: [],
        minMemory: "-Xms512M",
        maxMemory: "-Xmx2560M",
        online: false,
      },
      owner.tokens.access_token,
    );
    expect(updated.status).toBe(200);

    for (let attempt = 0; attempt < 30; attempt++) {
      const probe = await api(flow.baseUrl).get("/v1/launcher/config");
      if (
        probe.status === 200 &&
        ((await probe.json()) as Record<string, unknown>)["projectName"] === "Flow Project 2"
      )
        break;
      await Bun.sleep(100);
    }

    const reread = await api(flow.baseUrl).get("/v1/launcher/config");
    const rereadBody = (await reread.json()) as Record<string, unknown>;
    expect(rereadBody["projectName"]).toBe("Flow Project 2");
    expect(rereadBody["online"]).toBeFalse();
  });
});

function publishZipForm(version: string, payload: string): FormData {
  const form = new FormData();
  form.append("version", version);
  form.append("linux_x86_64", new Blob([payload]), `limacina-${version}.zip`);
  return form;
}
