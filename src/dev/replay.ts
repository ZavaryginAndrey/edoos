// Replay: повторяет задачу из сохраненного трейса через текущий runHealthAgent и сравнивает «было / стало».
// Используется CLI (scripts/replay.ts) и страницей /dev (app/api/dev/replay).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runHealthAgent, type HealthAgentResult } from "../harness/runHealthAgent";
import { buildTrace, type RunTrace } from "../harness/traceRun";

const RUNS_DIR = join(process.cwd(), "runs");
// runId из имени файла runs/<runId>.json; без разделителей пути, чтобы не выйти за пределы runs/.
const RUN_ID = /^run-[\w-]+$/;

export type TraceSummary = Pick<RunTrace, "runId" | "task" | "verdict" | "finalScore" | "createdAt">;
export type CompareRow = { name: string; before: string; after: string; changed: boolean };
export type ReplayResult = { before: RunTrace; after: RunTrace; result: HealthAgentResult; rows: CompareRow[]; changed: string[] };

export const summarizeTrace = ({ runId, task, verdict, finalScore, createdAt }: RunTrace): TraceSummary =>
  ({ runId, task, verdict, finalScore, createdAt });

export function parseTrace(text: string, source: string): RunTrace {
  let trace: RunTrace;
  try {
    trace = JSON.parse(text) as RunTrace;
  } catch (error) {
    throw new Error(`Не удалось прочитать трейс ${source}: ${error instanceof Error ? error.message : error}`);
  }
  if (typeof trace?.task !== "string" || !trace.task.trim()) throw new Error(`В ${source} нет task — это не трейс запуска.`);
  return trace;
}

export async function readTrace(runId: string): Promise<RunTrace> {
  if (!RUN_ID.test(runId)) throw new Error(`Некорректный runId: ${runId}`);
  const file = `runs/${runId}.json`;
  const text = await readFile(join(RUNS_DIR, `${runId}.json`), "utf8").catch(() => {
    throw new Error(`Трейс ${file} не найден.`);
  });
  return parseTrace(text, file);
}

// Новые трейсы сверху. Нечитаемые файлы пропускаются: список — для выбора, а не для валидации.
export async function listTraces(): Promise<TraceSummary[]> {
  const files = await readdir(RUNS_DIR).catch(() => [] as string[]);
  const ids = files.filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5)).filter((id) => RUN_ID.test(id));
  const traces = await Promise.all(ids.map((id) => readTrace(id).then(summarizeTrace, () => null)));
  return traces.filter((trace) => trace !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const showRounds = (trace: RunTrace) =>
  `${trace.rounds.length}: ${trace.rounds.map((r) => `${r.review.verdict}(${r.review.score})`).join(" → ")}`;
const FIELDS: [string, (trace: RunTrace) => string][] = [
  ["verdict", (t) => t.verdict],
  ["finalScore", (t) => String(t.finalScore ?? "—")],
  ["раунды", showRounds],
  ["toolCalls", (t) => t.toolCalls.join(", ") || "—"],
  ["promptVersions", (t) => `coach=${t.promptVersions.coach}, reviewer=${t.promptVersions.reviewer}`],
  ["model", (t) => t.model],
  ["durationMs", (t) => String(t.durationMs)],
];

// changed — существенные отличия: durationMs меняется всегда, поэтому в итог не входит.
export function compareTraces(before: RunTrace, after: RunTrace): { rows: CompareRow[]; changed: string[] } {
  const rows = FIELDS.map(([name, show]) => {
    const [a, b] = [show(before), show(after)];
    return { name, before: a, after: b, changed: a !== b };
  });
  const changed = rows.filter((row) => row.changed && row.name !== "durationMs").map((row) => row.name);
  return { rows, changed };
}

export async function replayTrace(before: RunTrace): Promise<ReplayResult> {
  const result = await runHealthAgent(before.task);
  const after = buildTrace(before.task, result);
  return { before, after, result, ...compareTraces(before, after) };
}
