import { createHealthCoach } from "../agents/healthCoach";
import { buttonServerConfigs, connectServers, LATEST_PLAN_URI, readResource } from "../mcp/servers";
import { DATA_SERVER, MCP_SERVERS } from "../mcp/servers.config";
import { configureDeepSeek, modelName, normalizePlan, runCoach, todayLine } from "./coachRun";
import { ACTIVE_PROMPTS, loadPrompt } from "./promptVersions";

// Поручение: создать страницу, при необходимости найти родителя и дописать содержимое — несколько ходов.
const ACTION_MAX_TURNS = 8;

export type ServerActionResult = { server: string; output: string; toolCalls: string[]; durationMs: number };

// Действие по кнопке под одобренным планом (сервер из конфига с полем button, например notion).
// Наружу уходит только одобренный план: присланный текст сверяется с plans://latest — последним планом,
// который прошёл ревью и был сохранён. Сервер действия видит только коуч этого поручения, в обычном
// запуске агента он не поднимается.
export async function runServerAction(serverName: string, plan: string): Promise<ServerActionResult> {
  const startedAt = performance.now();
  const config = buttonServerConfigs().find((server) => server.name === serverName);
  if (!config) throw new Error(`Действие «${serverName}» недоступно: сервера нет в конфиге или он выключен.`);
  const dataConfig = MCP_SERVERS.find((server) => server.name === DATA_SERVER && server.enabled);
  if (!dataConfig) throw new Error(`Нужен MCP-сервер ${DATA_SERVER}: без него не проверить, что план одобрен.`);

  configureDeepSeek();
  const instructions = await loadPrompt("healthCoach", ACTIVE_PROMPTS.coach);

  const servers = await connectServers([dataConfig, config]);
  try {
    const dataServer = servers.active.find((server) => server.name === DATA_SERVER);
    const target = servers.active.find((server) => server.name === serverName);
    if (!dataServer || !target) throw new Error(`MCP-сервер ${!dataServer ? DATA_SERVER : serverName} не запустился.`);

    if (normalizePlan(await readResource(dataServer, LATEST_PLAN_URI)) !== normalizePlan(plan)) {
      throw new Error("Этот план не совпадает с последним одобренным (data/output.md): он не прошёл ревью или уже заменён новым.");
    }

    const coach = createHealthCoach(modelName(), instructions, [target]);
    const input = `${todayLine()}\n\n${config.button!.task}\n\n${plan}`;
    const { output, toolCalls } = await runCoach(coach, input, { approvedPlan: plan }, ACTION_MAX_TURNS);
    console.log(`Действие ${serverName}: ${output}`);
    return { server: serverName, output, toolCalls, durationMs: Math.round(performance.now() - startedAt) };
  } finally {
    await servers.close();
  }
}
