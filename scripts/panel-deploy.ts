import { TechnicalPanelDeployService } from "../src/technical/technical-panel-deploy.service";
import { resolvePanelRepoDir } from "../src/technical/panel-deploy-dirs";
import { terminateActiveSteps } from "../src/utils/technical-steps";

const [, , ref] = process.argv;
const repoDir = resolvePanelRepoDir(process.env["PANEL_REPO_DIR"]);
const panelDeploy = new TechnicalPanelDeployService({ repoDir });

let shuttingDown = false;
async function shutdownOnSignal(signal: NodeJS.Signals, exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`Получен ${signal}: прерывание активного шага деплоя панели…`);
  await terminateActiveSteps();
  process.exit(exitCode);
}

process.on("SIGINT", () => void shutdownOnSignal("SIGINT", 130));
process.on("SIGTERM", () => void shutdownOnSignal("SIGTERM", 143));

panelDeploy
  .deploy(ref)
  .then((result) => {
    console.log(
      `Панель развёрнута: ref ${result.ref}, ревизия ${result.revision}, каталог ${result.panelDir}`,
    );
  })
  .catch((error: unknown) => {
    console.error("Деплой панели не удался:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
