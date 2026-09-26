import { Agent, type MCPServer } from "@openai/agents";
import { generateShoppingList } from "../skills/shopping";
import { suggestWorkoutTemplate } from "../skills/workouts";

// Контекст запуска коуча. Заполняет только harness: approvedPlan появляется после approve ревьюера
// и открывает afterApprove-tools из src/mcp/servers.config.ts.
export type CoachContext = { approvedPlan?: string };

// Локальные tools — обычные функции в этом же процессе. Всё остальное (данные пользователя, файлы, погода,
// Notion) коуч получает от MCP-серверов из конфига: для модели это такие же tools.
const COACH_TOOLS = [suggestWorkoutTemplate, generateShoppingList];

// Текст промпта — prompts/healthCoach.<версия>.md, загружается через src/harness/promptVersions.ts.
// includeServerInToolNames: модель видит MCP-tools как mcp_<сервер>__<tool>, поэтому имена разных серверов
// не конфликтуют, а в toolCalls и трейсе сразу виден источник. Локальные tools остаются без префикса.
export const createHealthCoach = (model: string, instructions: string, mcpServers: MCPServer[]) =>
  new Agent<CoachContext>({
    name: "Health Coach Agent",
    instructions,
    model,
    tools: COACH_TOOLS,
    mcpServers,
    mcpConfig: { includeServerInToolNames: true },
  });
