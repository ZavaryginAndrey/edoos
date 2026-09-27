import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Retrieval } from "../rag/retriever";
import type { PromptVersions } from "./promptVersions";
import type { Review } from "./validateReview";

// Как и data/ и prompts/, трейсы пишутся от cwd: и next dev, и npm-скрипты запускаются из корня репозитория.
const RUNS_DIR = join(process.cwd(), "runs");
const PLAN_EXCERPT_LENGTH = 500;

export type RunTrace = {
  runId: string;
  task: string;
  promptVersions: PromptVersions;
  model: string;
  rounds: { round: number; planExcerpt: string; review: Review }[];
  toolCalls: string[];
  // Запросы к базе знаний и заголовки найденных чанков — чем коуч пользовался. В трейсах до RAG поля нет.
  retrievals?: Retrieval[];
  finalScore: number | null;
  verdict: Review["verdict"];
  durationMs: number;
  createdAt: string;
};

// Поля результата, из которых собирается трейс (подмножество HealthAgentResult — без цикла импортов).
type TracedResult = {
  model: string;
  review: Review;
  rounds: { round: number; plan: string; review: Review }[];
  finalScore: number | null;
  promptVersions: PromptVersions;
  toolCalls: string[];
  retrievals: Retrieval[];
  durationMs: number;
};

export function buildTrace(task: string, result: TracedResult, createdAt = new Date()): RunTrace {
  const iso = createdAt.toISOString();
  return {
    // Двоеточия из ISO-времени недопустимы в именах файлов Windows.
    runId: `run-${iso.replace(/[:.]/g, "-")}`,
    task,
    promptVersions: result.promptVersions,
    model: result.model,
    rounds: result.rounds.map(({ round, plan, review }) => ({ round, planExcerpt: plan.slice(0, PLAN_EXCERPT_LENGTH), review })),
    toolCalls: result.toolCalls,
    retrievals: result.retrievals,
    finalScore: result.finalScore,
    verdict: result.review.verdict,
    durationMs: result.durationMs,
    createdAt: iso,
  };
}

// Сохраняет runs/<runId>.json. Трейс — диагностика, а не часть результата: ошибка записи только логируется.
export async function traceRun(task: string, result: TracedResult): Promise<string | null> {
  try {
    const trace = buildTrace(task, result);
    const file = join(RUNS_DIR, `${trace.runId}.json`);
    await mkdir(RUNS_DIR, { recursive: true });
    await writeFile(file, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
    console.log(`Трейс сохранен: runs/${trace.runId}.json`);
    return file;
  } catch (error) {
    console.error("Не удалось сохранить трейс запуска:", error);
    return null;
  }
}
