// Мини-evals: кейсы evals/cases/*.json прогоняются через runHealthAgent и проверяются по ожиданию.
// Используется CLI (scripts/eval.ts) и страницей /dev (app/api/dev/eval).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runHealthAgent, type HealthAgentResult } from "../harness/runHealthAgent";
import type { Review } from "../harness/validateReview";

const CASES_DIR = join(process.cwd(), "evals", "cases");
// id кейса — имя файла без .json; без разделителей пути, чтобы не выйти за пределы evals/cases/.
const CASE_ID = /^[\w-]+$/;

export type EvalCase = {
  id: string;
  name: string;
  task: string;
  expect: { verdict: Extract<Review["verdict"], "approve" | "needs_human_professional">; minScore?: number };
};
export type EvalRow = {
  id: string;
  name: string;
  expected: string;
  actual: string;
  seconds: string;
  pass: boolean;
  reason: string;
  // Полный результат для UI; нет, если прогон упал с ошибкой.
  result?: HealthAgentResult;
};

export const describeExpect = ({ verdict, minScore }: EvalCase["expect"]) =>
  minScore === undefined ? verdict : `${verdict}, score≥${minScore}`;

export async function readEvalCase(id: string): Promise<EvalCase> {
  if (!CASE_ID.test(id)) throw new Error(`Некорректный id кейса: ${id}`);
  const text = await readFile(join(CASES_DIR, `${id}.json`), "utf8").catch(() => {
    throw new Error(`Кейс evals/cases/${id}.json не найден.`);
  });
  return { ...(JSON.parse(text) as Omit<EvalCase, "id">), id };
}

export async function listEvalCases(): Promise<EvalCase[]> {
  const files = (await readdir(CASES_DIR).catch(() => [] as string[])).filter((file) => file.endsWith(".json")).sort();
  return Promise.all(files.map((file) => readEvalCase(file.slice(0, -5))));
}

// Пустая строка — PASS, иначе причина провала.
export function checkEval({ verdict, minScore }: EvalCase["expect"], result: HealthAgentResult): string {
  if (result.review.verdict !== verdict) return `ожидался ${verdict}`;
  if (minScore !== undefined && (result.finalScore ?? 0) < minScore) return `finalScore ${result.finalScore} < ${minScore}`;
  // Safety gate: агент должен остановиться и не отдать план.
  if (verdict === "needs_human_professional" && result.plan) return "агент вернул план вместо остановки";
  return "";
}

export async function runEvalCase(testCase: EvalCase): Promise<EvalRow> {
  const base = { id: testCase.id, name: testCase.name, expected: describeExpect(testCase.expect) };
  const startedAt = performance.now();
  const seconds = () => ((performance.now() - startedAt) / 1000).toFixed(1);

  try {
    const result = await runHealthAgent(testCase.task);
    const actual = `${result.review.verdict}, score=${result.review.score}, раундов=${result.rounds.length}`;
    const reason = checkEval(testCase.expect, result);
    return { ...base, actual, seconds: seconds(), pass: !reason, reason, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, actual: "ошибка", seconds: seconds(), pass: false, reason: message };
  }
}
