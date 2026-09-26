// Повторяет задачу из сохраненного трейса через текущий runHealthAgent и печатает «было / стало».
// Запуск: npm run replay runs/run-XXX.json. Логика — в src/dev/replay.ts (её же использует /dev).
import { readFile } from "node:fs/promises";
import { parseTrace, replayTrace } from "../src/dev/replay";

const file = process.argv[2];
if (!file) {
  console.error("Укажи трейс: npm run replay runs/run-XXX.json");
  process.exit(1);
}

let old;
try {
  old = parseTrace(await readFile(file, "utf8"), file);
} catch (error) {
  console.error(error instanceof Error ? error.message : `Не удалось прочитать трейс ${file}: ${error}`);
  process.exit(1);
}

console.log(`Replay ${old.runId}\nЗадача: ${old.task}\n`);
const { rows, changed } = await replayTrace(old);

const width = (key: "name" | "before") => Math.max(4, ...rows.map((row) => row[key].length));
const [nameWidth, beforeWidth] = [width("name"), width("before")];

console.log(`\n  ${"поле".padEnd(nameWidth)}  ${"было".padEnd(beforeWidth)}  стало`);
for (const { name, before, after, changed: diff } of rows) {
  console.log(`${diff ? "≠" : " "} ${name.padEnd(nameWidth)}  ${before.padEnd(beforeWidth)}  ${after}`);
}
console.log(`\n${changed.length ? `Изменилось: ${changed.join(", ")}` : "Существенных изменений нет."}`);
