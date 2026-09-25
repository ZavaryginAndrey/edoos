import { Agent, run, setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled, type RunResult } from "@openai/agents";
import OpenAI from "openai";
import { createHealthCoach, type CoachContext } from "../agents/healthCoach";
import { createSafetyReviewer, reviewTaskSafety } from "../agents/safetyReviewer";
import { writePlan } from "../skills/plans";
import { ACTIVE_PROMPTS, loadPrompts, type PromptVersions } from "./promptVersions";
import { formatRound, RoundHistory, type RoundState } from "./rounds";
import { summarizeScore } from "./score";
import { validateReview, type Review } from "./validateReview";

const DEFAULT_MAX_ROUNDS = 3;
const DEFAULT_MIN_ROUNDS = 1;
// Каждый вызов tool — отдельный ход модели: профиль, дневник, рецепты, шаблон, список покупок и финальный ответ.
const COACH_MAX_TURNS = 8;
const SAVE_MAX_TURNS = 3;

export type { PromptVersions, Review, RoundState };
export type RunOptions = {
  maxRounds?: number;
  // Approve раньше этого раунда не завершает цикл: коуч дорабатывает план по замечаниям. Для тестов.
  minRounds?: number;
  promptVersions?: PromptVersions;
};
export type HealthAgentResult = {
  plan: string;
  review: Review;
  rounds: RoundState[];
  finalScore: number | null;
  improved: boolean;
  promptVersions: PromptVersions;
  // Имена tools, вызванных коучем, по порядку за весь запуск (все раунды и сохранение).
  toolCalls: string[];
  durationMs: number;
};

const outputText = (value: unknown) =>
  (typeof value === "string" ? value : JSON.stringify(value ?? "")).trim();

const calledTools = (result: RunResult<any, any>) =>
  result.newItems.flatMap((item) =>
    item.type === "tool_call_item" && item.rawItem.type === "function_call" ? [item.rawItem.name] : []);

async function runCoach(agent: Agent<CoachContext>, input: string, context: CoachContext, maxTurns: number) {
  const result = await run(agent, input, { context, maxTurns });
  const toolCalls = calledTools(result);
  if (toolCalls.length) console.log(`Коуч вызвал tools: ${toolCalls.join(", ")}`);
  return { output: outputText(result.finalOutput), toolCalls };
}

// Профиль и дневник больше не подставляются: коуч получает только задачу и сам запрашивает данные через tools.
function askCoach(agent: Agent<CoachContext>, task: string, previous: RoundState | undefined) {
  const issues = previous?.review.issues ?? [];
  const revision = issues.length
    ? `\n\nПредыдущий план:\n${previous!.plan}\n\nЗамечания Safety Reviewer:\n${issues.map((issue) => `- ${issue}`).join("\n")}\n\nИсправь план с учетом замечаний. Верни только обновленный план.`
    : "";
  return runCoach(agent, `Задача пользователя:\n${task}${revision}`, {}, COACH_MAX_TURNS);
}

// Ревьюер без tools и без данных пользователя: только задача и текст плана, ровно один ход.
async function askReviewer(agent: Agent, task: string, plan: string) {
  const prompt = `Задача пользователя:\n${task}\n\nПлан для проверки:\n${plan}`;
  return validateReview(async (retrySuffix) => {
    const result = await run(agent, `${prompt}${retrySuffix}`, { maxTurns: 1 });
    return outputText(result.finalOutput);
  });
}

// Сохранение — единственный побочный эффект, который зависит от вердикта, поэтому его открывает harness:
// approvedPlan в контексте включает savePlan (до approve коуч его просто не видит), а после запуска harness
// проверяет по context.saved, что сохранился именно одобренный план. Если модель tool не вызвала или
// исказила текст, одобренный план всё равно сохраняется напрямую — approve не должен теряться.
async function savePlanByCoach(agent: Agent<CoachContext>, plan: string) {
  const context: CoachContext = { approvedPlan: plan };
  const input = `Safety Reviewer одобрил план. Сохрани его: вызови savePlan и передай этот план дословно, больше ничего не делай.\n\n${plan}`;
  const { toolCalls } = await runCoach(agent, input, context, SAVE_MAX_TURNS);
  if (!context.saved) {
    console.log("Коуч не сохранил одобренный план через savePlan, harness сохраняет его напрямую.");
    await writePlan(plan);
  }
  return toolCalls;
}

function configureDeepSeek(apiKey: string) {
  // DeepSeek работает через OpenAI-compatible Chat Completions API.
  setTracingDisabled(true);
  setOpenAIAPI("chat_completions");
  setDefaultOpenAIClient(new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  }));
}

export async function runHealthAgent(task: string, options: RunOptions = {}): Promise<HealthAgentResult> {
  const { maxRounds = DEFAULT_MAX_ROUNDS, minRounds = DEFAULT_MIN_ROUNDS } = options;
  const startedAt = performance.now();
  const promptVersions = { ...(options.promptVersions ?? ACTIVE_PROMPTS) };
  const history = new RoundHistory();
  const toolCalls: string[] = [];
  const finish = (plan: string, review: Review): HealthAgentResult => {
    const rounds = history.toArray();
    const durationMs = Math.round(performance.now() - startedAt);
    return { plan, review, rounds, ...summarizeScore(rounds), promptVersions, toolCalls, durationMs };
  };

  task = task.trim();
  if (!task) throw new Error("Передай задачу.");
  if (!Number.isInteger(maxRounds) || maxRounds < 1) throw new Error("maxRounds должен быть целым числом не меньше 1.");
  if (!Number.isInteger(minRounds) || minRounds < 1 || minRounds > maxRounds) {
    throw new Error(`minRounds должен быть целым числом от 1 до maxRounds (${maxRounds}).`);
  }

  // Pre-check без LLM записывается как раунд 1 с пустым планом.
  const taskReview = reviewTaskSafety(task);
  if (taskReview) {
    console.log(formatRound(history.record("", taskReview)));
    console.log("Запрос требует специалиста. План не сохранен.");
    return finish("", taskReview);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("Добавь DEEPSEEK_API_KEY в .env");
  configureDeepSeek(apiKey);

  const prompts = await loadPrompts(promptVersions);
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
  const coach = createHealthCoach(model, prompts.coach);
  const reviewer = createSafetyReviewer(model, prompts.reviewer);

  // Коуч и ревьюер общаются через явные раунды оркестратора.
  for (let round = 1; round <= maxRounds; round += 1) {
    const coachRun = await askCoach(coach, task, history.last);
    toolCalls.push(...coachRun.toolCalls);
    const plan = coachRun.output;
    const review = await askReviewer(reviewer, task, plan);
    console.log(formatRound(history.record(plan, review)));

    if (review.verdict === "needs_human_professional") {
      console.log("Запрос требует специалиста. План не сохранен.");
      return finish("", review);
    }
    if (review.verdict === "approve" && round < minRounds) {
      console.log(`Approve до minRounds=${minRounds}, продолжаю доработку.`);
      continue;
    }
    if (review.verdict === "approve") {
      toolCalls.push(...await savePlanByCoach(coach, plan));
      console.log(`План сохранен в output.md. score=${review.score}`);
      return finish(plan, review);
    }
  }

  console.log(`План не прошел ревью за ${maxRounds} раунда. План не сохранен.`);
  const last = history.last!;
  return finish(last.plan, last.review);
}
