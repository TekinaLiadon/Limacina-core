import { describe, expect, it } from "bun:test";
import { parseLauncherConfig } from "../launcher.service";

describe("parseLauncherConfig — форма config.toml", (): void => {
  const validToml = `projectName = "Cordelia"
mcVersion = "1.21.1"
modLoader = "neoforge"
loaderVersion = "21.1.234"
jvmArgs = ["-Xms512M", "-Xmx2560M"]
minMemory = "-Xms512M"
maxMemory = "-Xmx2560M"
online = true`;

  it("парсит валидный конфиг в LauncherConfigDto", (): void => {
    const config = parseLauncherConfig(validToml);

    expect(config).toEqual({
      projectName: "Cordelia",
      mcVersion: "1.21.1",
      modLoader: "neoforge",
      loaderVersion: "21.1.234",
      jvmArgs: ["-Xms512M", "-Xmx2560M"],
      minMemory: "-Xms512M",
      maxMemory: "-Xmx2560M",
      online: true,
    });
  });

  it("отбрасывает посторонние ключи, не нарушая форму DTO", (): void => {
    const config = parseLauncherConfig(`${validToml}\nextraneous = "junk"`);

    expect(config).toBeDefined();
    expect("extraneous" in config!).toBe(false);
  });

  it("отклоняет поле неверного типа (online строкой)", (): void => {
    expect(
      parseLauncherConfig(validToml.replace("online = true", 'online = "yes"')),
    ).toBeUndefined();
  });

  it("отклоняет jvmArgs не-массивом", (): void => {
    expect(
      parseLauncherConfig(
        validToml.replace('jvmArgs = ["-Xms512M", "-Xmx2560M"]', 'jvmArgs = "-Xms512M"'),
      ),
    ).toBeUndefined();
  });

  it("отклоняет jvmArgs с не-строковым элементом", (): void => {
    expect(
      parseLauncherConfig(
        validToml.replace('jvmArgs = ["-Xms512M", "-Xmx2560M"]', "jvmArgs = [512]"),
      ),
    ).toBeUndefined();
  });

  it("отклоняет конфиг без обязательного поля", (): void => {
    expect(parseLauncherConfig(validToml.replace('minMemory = "-Xms512M"\n', ""))).toBeUndefined();
  });
});
