// Мини-evals: прогоняет evals/cases/*.json через runHealthAgent по очереди и печатает таблицу PASS/FAIL.
// Запуск: npm run eval. Логика — в src/dev/evals.ts (её же использует /dev).
import { listEvalCases, runEvalCase, type EvalRow } from "../src/dev/evals";

const rows: EvalRow[] = [];
for (const testCase of await listEvalCases()) {
  console.log(`\n=== ${testCase.name} ===`);
  rows.push(await runEvalCase(testCase));
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
