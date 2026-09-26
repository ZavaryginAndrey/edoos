// Повторяет задачу из сохраненного трейса через текущий runHealthAgent и печатает «было / стало».
// Запуск: npm run replay runs/run-XXX.json
import { readFile } from "node:fs/promises";
import { runHealthAgent } from "../src/harness/runHealthAgent";
import { buildTrace, type RunTrace } from "../src/harness/traceRun";

const file = process.argv[2];
if (!file) {
  console.error("Укажи трейс: npm run replay runs/run-XXX.json");
  process.exit(1);
}

const old = await readFile(file, "utf8").then((text) => JSON.parse(text) as RunTrace).catch((error: Error) => {
  console.error(`Не удалось прочитать трейс ${file}: ${error.message}`);
  process.exit(1);
});
if (typeof old.task !== "string" || !old.task.trim()) {
  console.error(`В ${file} нет task — это не трейс запуска.`);
  process.exit(1);
}

console.log(`Replay ${old.runId}\nЗадача: ${old.task}\n`);
const current = buildTrace(old.task, await runHealthAgent(old.task));

const rounds = (trace: RunTrace) =>
  `${trace.rounds.length}: ${trace.rounds.map((r) => `${r.review.verdict}(${r.review.score})`).join(" → ")}`;
const rows: [string, (trace: RunTrace) => string][] = [
  ["verdict", (t) => t.verdict],
  ["finalScore", (t) => String(t.finalScore ?? "—")],
  ["раунды", rounds],
  ["toolCalls", (t) => t.toolCalls.join(", ") || "—"],
  ["promptVersions", (t) => `coach=${t.promptVersions.coach}, reviewer=${t.promptVersions.reviewer}`],
  ["model", (t) => t.model],
  ["durationMs", (t) => String(t.durationMs)],
];

const table = rows.map(([name, show]) => {
  const [before, after] = [show(old), show(current)];
  return { name, before, after, mark: before === after ? " " : "≠" };
});
const width = (key: "name" | "before") => Math.max(4, ...table.map((row) => row[key].length));
const [nameWidth, beforeWidth] = [width("name"), width("before")];

console.log(`\n  ${"поле".padEnd(nameWidth)}  ${"было".padEnd(beforeWidth)}  стало`);
for (const { name, before, after, mark } of table) {
  console.log(`${mark} ${name.padEnd(nameWidth)}  ${before.padEnd(beforeWidth)}  ${after}`);
}

// durationMs меняется всегда, поэтому в итог не входит.
const changed = table.filter((row) => row.mark !== " " && row.name !== "durationMs").map((row) => row.name);
console.log(`\n${changed.length ? `Изменилось: ${changed.join(", ")}` : "Существенных изменений нет."}`);
