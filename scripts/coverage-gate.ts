import { readFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const thresholdArg = argv.find((arg) => arg.startsWith("--threshold="));
const coverageDirArg = argv.find((arg) => !arg.startsWith("--"));
const COVERAGE_DIR = coverageDirArg ?? join(import.meta.dir, "..", "coverage");
const LCOV_FILE = join(COVERAGE_DIR, "lcov.info");
const DEFAULT_THRESHOLD = 70;
const THRESHOLD = thresholdArg ? Number(thresholdArg.split("=")[1]) : DEFAULT_THRESHOLD;

interface CoverageStats {
  totalLines: number;
  coveredLines: number;
}

function parseLcov(content: string): CoverageStats {
  let totalLines = 0;
  let coveredLines = 0;

  for (const line of content.split("\n")) {
    if (!line.startsWith("DA:")) continue;

    const executionCount = Number(line.slice(3).split(",")[1]);
    totalLines++;
    if (executionCount > 0) {
      coveredLines++;
    }
  }

  return { totalLines, coveredLines };
}

function main(): void {
  let content: string;
  try {
    content = readFileSync(LCOV_FILE, "utf-8");
  } catch {
    console.error(`Файл покрытия не найден: ${LCOV_FILE}. Запустите: bun test --coverage`);
    process.exit(1);
  }

  const { totalLines, coveredLines } = parseLcov(content);
  if (totalLines === 0) {
    console.error("Отчёт покрытия пуст: нет строк для подсчёта");
    process.exit(1);
  }

  const percent = (coveredLines / totalLines) * 100;

  if (percent < THRESHOLD) {
    console.error(
      `Общее покрытие ${percent.toFixed(2)}% ниже порога ${THRESHOLD}% (${coveredLines}/${totalLines} строк)`,
    );
    process.exit(1);
  }

  console.log(
    `Общее покрытие ${percent.toFixed(2)}% ≥ порога ${THRESHOLD}% (${coveredLines}/${totalLines} строк)`,
  );
}

main();
