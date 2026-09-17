/**
 * Параллельный прогон флоу-тестов (src/e2e/flows/): каждый файл — отдельный процесс `bun test`
 * со своей одноразовой БД (имя с PID из харнеса). Bun сам по себе гоняет файлы последовательно
 * в одном процессе, поэтому ускорение даёт именно мультипроцессный запуск.
 *
 * Эксклюзивные файлы (мутируют общие файлы репо: bootstrap.token, config.toml, public/releases)
 * выполняются по одному; остальные — пулом по FLOW_CONCURRENCY (по умолчанию 4).
 *
 * Запуск: bun run test:flows (скрипт test:flows в package.json). Покрытие этим прогоном
 * не собирается — для покрытия гони обычный `bun test` / check-all.
 */
const EXCLUSIVE = new Set([
  "src/e2e/flows/bootstrap-owner.e2e.test.ts",
  "src/e2e/flows/launcher-releases.e2e.test.ts",
]);

const CONCURRENCY = Number(process.env["FLOW_CONCURRENCY"] ?? 4);

async function runOne(file: string): Promise<boolean> {
  console.log(`\n=== [flows] ${file} ===`);
  const proc = Bun.spawn(["bun", "test", "--timeout", "30000", file], {
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  return (await proc.exited) === 0;
}

async function runWithConcurrency(files: string[], concurrency: number): Promise<boolean> {
  const queue = [...files];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    let ok = true;
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      ok = (await runOne(file)) && ok;
    }
    return ok;
  });
  const results = await Promise.all(workers);
  return results.every(Boolean);
}

const allFiles = [...new Bun.Glob("src/e2e/flows/*.e2e.test.ts").scanSync()].sort();
if (allFiles.length === 0) {
  console.error("Флоу-файлы не найдены");
  process.exit(1);
}

const exclusive = allFiles.filter((file) => EXCLUSIVE.has(file));
const parallel = allFiles.filter((file) => !EXCLUSIVE.has(file));
console.log(
  `[flows] файлов: ${allFiles.length} (эксклюзивных: ${exclusive.length}, параллельных: ${parallel.length}, потоков: ${CONCURRENCY})`,
);

let ok = true;
// Эксклюзивные — строго по одному до параллельного батча.
for (const file of exclusive) {
  ok = (await runOne(file)) && ok;
}
ok = (await runWithConcurrency(parallel, CONCURRENCY)) && ok;

console.log(ok ? "\n[flows] всё зелёное" : "\n[flows] есть падения");
process.exit(ok ? 0 : 1);
