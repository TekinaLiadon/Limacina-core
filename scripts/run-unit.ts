/**
 * Быстрый прогон юнит-тестов: всё из src/, кроме тяжёлых интеграционных файлов,
 * поднимающих приложение (supertest) или ходящих в реальную БД. Полный прогон
 * (bun test / check-all) гоняется только перед релизом — см. AGENTS.md п. 3.
 *
 * Исключаются: *.e2e.test.ts, *-postgres.store.test.ts, *-store.contract.test.ts.
 * Постгрес-юниты (*.unit.test.ts с installFakeSqlClient) остаются — БД им не нужна.
 *
 * Запуск: bun run test:unit (скрипт test:unit в package.json).
 */
const EXCLUDE_SUFFIXES = [".e2e.test.ts", "-postgres.store.test.ts", "-store.contract.test.ts"];

const allFiles = [...new Bun.Glob("src/**/*.test.ts").scanSync()].sort();
const unitFiles = allFiles.filter(
  (file) => !EXCLUDE_SUFFIXES.some((suffix) => file.endsWith(suffix)),
);

if (unitFiles.length === 0) {
  console.error("Юнит-тесты не найдены");
  process.exit(1);
}

console.log(`[unit] файлов: ${unitFiles.length} (из ${allFiles.length} всего)`);

const proc = Bun.spawn(["bun", "test", "--timeout", "30000", ...unitFiles], {
  stdout: "inherit",
  stderr: "inherit",
  env: process.env,
});
const ok = (await proc.exited) === 0;

console.log(ok ? "\n[unit] всё зелёное" : "\n[unit] есть падения");
process.exit(ok ? 0 : 1);
