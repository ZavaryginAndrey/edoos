// Мини-evals: прогоняет evals/cases/*.json через runHealthAgent по очереди и печатает таблицу PASS/FAIL.
// Запуск: npm run eval
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runHealthAgent } from "../src/harness/runHealthAgent";
import type { Review } from "../src/harness/validateReview";

type EvalCase = {
  name: string;
  task: string;
  expect: { verdict: Extract<Review["verdict"], "approve" | "needs_human_professional">; minScore?: number };
};
type Row = { name: string; expected: string; actual: string; seconds: string; pass: boolean; reason: string };

const CASES_DIR = join(process.cwd(), "evals", "cases");
const files = (await readdir(CASES_DIR)).filter((file) => file.endsWith(".json")).sort();
const rows: Row[] = [];

for (const file of files) {
  const testCase = JSON.parse(await readFile(join(CASES_DIR, file), "utf8")) as EvalCase;
  const { verdict, minScore } = testCase.expect;
  const expected = minScore === undefined ? verdict : `${verdict}, score≥${minScore}`;
  console.log(`\n=== ${testCase.name} ===`);
  const startedAt = performance.now();
  const seconds = () => ((performance.now() - startedAt) / 1000).toFixed(1);

  try {
    const result = await runHealthAgent(testCase.task);
    const actual = `${result.review.verdict}, score=${result.review.score}, раундов=${result.rounds.length}`;
    let reason = "";
    if (result.review.verdict !== verdict) reason = `ожидался ${verdict}`;
    else if (minScore !== undefined && (result.finalScore ?? 0) < minScore) reason = `finalScore ${result.finalScore} < ${minScore}`;
    // Safety gate: агент должен остановиться и не отдать план.
    else if (verdict === "needs_human_professional" && result.plan) reason = "агент вернул план вместо остановки";
    rows.push({ name: testCase.name, expected, actual, seconds: seconds(), pass: !reason, reason });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rows.push({ name: testCase.name, expected, actual: "ошибка", seconds: seconds(), pass: false, reason: message });
  }
}

const header = { name: "кейс", expected: "ожидание", actual: "факт", seconds: "сек" };
const columns = ["name", "expected", "actual", "seconds"] as const;
const widths = columns.map((key) => Math.max(header[key].length, ...rows.map((row) => row[key].length)));
const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i])).join("  ");

console.log(`\n      ${line(columns.map((key) => header[key]))}`);
for (const row of rows) {
  console.log(`${row.pass ? "PASS" : "FAIL"}  ${line(columns.map((key) => row[key]))}${row.reason ? `  ← ${row.reason}` : ""}`);
}

const passed = rows.filter((row) => row.pass).length;
console.log(`\n${passed}/${rows.length} PASS`);
process.exitCode = passed === rows.length ? 0 : 1;
