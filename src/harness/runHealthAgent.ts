import { run, type Agent, type MCPServer } from "@openai/agents";
import { createHealthCoach, type CoachContext } from "../agents/healthCoach";
import { createSafetyReviewer, reviewTaskSafety } from "../agents/safetyReviewer";
import { buttonServerConfigs, connectServers, LATEST_PLAN_URI, readResource, runServerConfigs } from "../mcp/servers";
import { DATA_SERVER } from "../mcp/servers.config";
import { configureDeepSeek, modelName, normalizePlan, outputText, runCoach, todayLine } from "./coachRun";
import { ACTIVE_PROMPTS, loadPrompts, type PromptVersions } from "./promptVersions";
import { formatRound, RoundHistory, type RoundState } from "./rounds";
import { summarizeScore } from "./score";
import { traceRun } from "./traceRun";
import { validateReview, type Review } from "./validateReview";

const DEFAULT_MAX_ROUNDS = 3;
const DEFAULT_MIN_ROUNDS = 1;
// Каждый вызов tool — отдельный ход модели: профиль, дневник, рецепты, погода, шаблон, список покупок и ответ.
const COACH_MAX_TURNS = 8;
// Шаг сохранения: save_health_plan, файл в plans/ (если пользователь просил) и финальный ответ.
const SAVE_MAX_TURNS = 6;

export type { PromptVersions, Review, RoundState };
export type RunOptions = {
  maxRounds?: number;
  // Approve раньше этого раунда не завершает цикл: коуч дорабатывает план по замечаниям. Для тестов.
  minRounds?: number;
  promptVersions?: PromptVersions;
};
// Действие по кнопке под одобренным планом: сервер из конфига с полем button (например, notion).
export type PlanAction = { server: string; label: string };
export type HealthAgentResult = {
  plan: string;
  review: Review;
  rounds: RoundState[];
  finalScore: number | null;
  improved: boolean;
  promptVersions: PromptVersions;
  model: string;
  // Имена tools, вызванных коучем, по порядку за весь запуск (все раунды и сохранение): MCP-tools с префиксом
  // источника mcp_<сервер>__<tool>, локальные — без префикса.
  toolCalls: string[];
  // Включённые серверы «по кнопке»: UI показывает их под одобренным планом.
  actions: PlanAction[];
  durationMs: number;
};

// Профиль и дневник не подставляются: коуч получает только дату и задачу и сам запрашивает данные через tools.
function askCoach(agent: Agent<CoachContext>, task: string, previous: RoundState | undefined) {
  const issues = previous?.review.issues ?? [];
  const revision = issues.length
    ? `\n\nПредыдущий план:\n${previous!.plan}\n\nЗамечания Safety Reviewer:\n${issues.map((issue) => `- ${issue}`).join("\n")}\n\nИсправь план с учетом замечаний. Верни только обновленный план.`
    : "";
  return runCoach(agent, `${todayLine()}\n\nЗадача пользователя:\n${task}${revision}`, {}, COACH_MAX_TURNS);
}

// Ревьюер без tools и без данных пользователя: только задача и текст плана, ровно один ход.
async function askReviewer(agent: Agent, task: string, plan: string) {
  const prompt = `Задача пользователя:\n${task}\n\nПлан для проверки:\n${plan}`;
  return validateReview(async (retrySuffix) => {
    const result = await run(agent, `${prompt}${retrySuffix}`, { maxTurns: 1 });
    return outputText(result.finalOutput);
  });
}

// Сохранение — побочный эффект, который зависит от вердикта, поэтому его открывает harness: approvedPlan
// в контексте открывает коучу afterApprove-tools (save_health_plan, запись в plans/ — см. servers.config.ts).
// Задача пользователя нужна коучу, чтобы понять, просили ли сохранить план ещё и в файл. После шага harness
// читает plans://latest и сверяет с одобренным планом: если модель tool не вызвала или исказила текст,
// harness сам сохраняет одобренный план через тот же MCP-сервер — approve не должен теряться.
async function savePlanByCoach(agent: Agent<CoachContext>, dataServer: MCPServer | undefined, task: string, plan: string) {
  const context: CoachContext = { approvedPlan: plan };
  const input = `${todayLine()}\n\nЗадача пользователя:\n${task}\n\n` +
    "Safety Reviewer одобрил план ниже. Сохрани его: вызови mcp_markdown_health__save_health_plan и передай план дословно. " +
    "Если в задаче пользователь просил сохранить план ещё и в файл, запиши его через tools filesystem по правилам. " +
    `Других tools не вызывай (список покупок, данные и прогноз уже учтены в плане).\n\n${plan}`;
  const { toolCalls } = await runCoach(agent, input, context, SAVE_MAX_TURNS);
  if (!dataServer) {
    console.log(`MCP-сервер ${DATA_SERVER} не подключён: сохранение в data/output.md не проверено.`);
    return toolCalls;
  }
  if (normalizePlan(await readResource(dataServer, LATEST_PLAN_URI)) !== normalizePlan(plan)) {
    console.log("Коуч не сохранил одобренный план через save_health_plan, harness сохраняет его через MCP сам.");
    await dataServer.callTool("save_health_plan", { markdown: plan });
  }
  return toolCalls;
}

export async function runHealthAgent(task: string, options: RunOptions = {}): Promise<HealthAgentResult> {
  const { maxRounds = DEFAULT_MAX_ROUNDS, minRounds = DEFAULT_MIN_ROUNDS } = options;
  const startedAt = performance.now();
  const promptVersions = { ...(options.promptVersions ?? ACTIVE_PROMPTS) };
  const model = modelName();
  const history = new RoundHistory();
  const toolCalls: string[] = [];
  const actions = buttonServerConfigs().map(({ name, button }) => ({ server: name, label: button!.label }));
  // Каждый завершенный запуск пишет трейс в runs/; ошибка записи не роняет запуск (см. traceRun).
  const finish = async (plan: string, review: Review): Promise<HealthAgentResult> => {
    const rounds = history.toArray();
    const durationMs = Math.round(performance.now() - startedAt);
    const result = { plan, review, rounds, ...summarizeScore(rounds), promptVersions, model, toolCalls, actions, durationMs };
    await traceRun(task, result);
    return result;
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

  configureDeepSeek();
  const prompts = await loadPrompts(promptVersions);
  const reviewer = createSafetyReviewer(model, prompts.reviewer);

  // Коуч и ревьюер общаются через явные раунды оркестратора. Возвращает итоговые план и ревью.
  const runRounds = async (servers: MCPServer[]): Promise<[plan: string, review: Review]> => {
    const coach = createHealthCoach(model, prompts.coach, servers);
    const dataServer = servers.find((server) => server.name === DATA_SERVER);
    for (let round = 1; round <= maxRounds; round += 1) {
      const coachRun = await askCoach(coach, task, history.last);
      toolCalls.push(...coachRun.toolCalls);
      const plan = coachRun.output;
      const review = await askReviewer(reviewer, task, plan);
      console.log(formatRound(history.record(plan, review)));

      if (review.verdict === "needs_human_professional") {
        console.log("Запрос требует специалиста. План не сохранен.");
        return ["", review];
      }
      if (review.verdict === "approve" && round < minRounds) {
        console.log(`Approve до minRounds=${minRounds}, продолжаю доработку.`);
        continue;
      }
      if (review.verdict === "approve") {
        toolCalls.push(...await savePlanByCoach(coach, dataServer, task, plan));
        console.log(`План одобрен и сохранен. score=${review.score}`);
        return [plan, review];
      }
    }

    console.log(`План не прошел ревью за ${maxRounds} раунда. План не сохранен.`);
    const last = history.last!;
    return [last.plan, last.review];
  };

  // MCP-серверы из src/mcp/servers.config.ts живут ровно один запуск: процессы стартуют здесь и завершаются
  // в finally, в том числе если раунд упал с ошибкой. Pre-check выше обходится без них.
  const servers = await connectServers(runServerConfigs());
  let outcome: [plan: string, review: Review];
  try {
    outcome = await runRounds(servers.active);
  } finally {
    await servers.close();
  }
  return finish(...outcome);
}
