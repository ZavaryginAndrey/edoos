import { run, setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled, type Agent, type RunResult } from "@openai/agents";
import OpenAI from "openai";
import type { CoachContext } from "../agents/healthCoach";

// Общее для запуска агента (runHealthAgent) и действий по кнопке (runServerAction).

const DEFAULT_MODEL = "deepseek-v4-flash";

export const modelName = () => process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;

export function configureDeepSeek() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("Добавь DEEPSEEK_API_KEY в .env");
  // DeepSeek работает через OpenAI-compatible Chat Completions API.
  setTracingDisabled(true);
  setOpenAIAPI("chat_completions");
  setDefaultOpenAIClient(new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  }));
}

export const outputText = (value: unknown) =>
  (typeof value === "string" ? value : JSON.stringify(value ?? "")).trim();

// Такой ответ SDK подставляет модели вместо результата, если tool нет (сервер выключен или tool скрыт).
const TOOL_NOT_FOUND = /^Tool '.+' not found\.$/;

// Имена — те, что видела модель: MCP-tools с префиксом mcp_<сервер>__, локальные как есть. Вызовы tools,
// которых у агента не было, в список не попадают: они не выполнялись, только логируются.
function calledTools(result: RunResult<any, any>): string[] {
  const missing = new Set(result.newItems.flatMap((item) =>
    item.type === "tool_call_output_item" && TOOL_NOT_FOUND.test(outputText(item.output)) && "callId" in item.rawItem
      ? [item.rawItem.callId]
      : []));
  const calls = result.newItems.flatMap((item) =>
    item.type === "tool_call_item" && item.rawItem.type === "function_call" ? [item.rawItem] : []);
  const skipped = calls.filter((call) => missing.has(call.callId)).map((call) => call.name);
  if (skipped.length) console.log(`Коуч пытался вызвать недоступные tools: ${skipped.join(", ")}`);
  return calls.filter((call) => !missing.has(call.callId)).map((call) => call.name);
}

// return_error_to_model: промпт знает про tools всех серверов, а сервер может быть выключен в конфиге, не стартовать
// или прятать tool до approve. Вызов отсутствующего tool возвращается модели как ошибка, а не роняет запуск.
// retrievals — запросы к базе знаний за этот запуск: searchKnowledge пишет их в контекст (SDK передаёт tool тот же объект).
export async function runCoach(agent: Agent<CoachContext>, input: string, context: CoachContext, maxTurns: number) {
  const runContext: CoachContext = { ...context, retrievals: [] };
  const result = await run(agent, input, { context: runContext, maxTurns, toolNotFoundBehavior: "return_error_to_model" });
  const toolCalls = calledTools(result);
  if (toolCalls.length) console.log(`Коуч вызвал tools: ${toolCalls.join(", ")}`);
  return { output: outputText(result.finalOutput), toolCalls, retrievals: runContext.retrievals ?? [] };
}

// Модель не знает текущую дату, а без неё не посчитать «завтра», прогноз на нужный день и имя plans/<дата>.md.
export function todayLine(now = new Date()): string {
  const human = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `Сегодня: ${human} (${iso}).`;
}

export const normalizePlan = (markdown: string) => markdown.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
