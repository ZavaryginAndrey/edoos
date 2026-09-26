import { connectMcpServers, MCPServerStdio, type MCPServer, type MCPToolFilterCallable } from "@openai/agents";
import type { CoachContext } from "../agents/healthCoach";
import { MCP_SERVERS, type McpServerConfig } from "./servers.config";

// Последний сохранённый план: по нему harness проверяет, что на диск попал именно одобренный текст.
export const LATEST_PLAN_URI = "plans://latest";

// Серверы обычного запуска и серверы «по кнопке». Выключенные (в том числе notion без NOTION_TOKEN)
// отсеиваются здесь и не запускаются вовсе.
export const runServerConfigs = () => MCP_SERVERS.filter((server) => server.enabled && !server.button);
export const buttonServerConfigs = () => MCP_SERVERS.filter((server) => server.enabled && server.button);

// Гейт tools из конфига. Сервер о вердиктах ничего не знает — решает клиент: afterApprove-tools появляются,
// только когда harness положил в контекст approvedPlan (шаг сохранения или кнопка под одобренным планом).
function configToolFilter({ tools = {} }: McpServerConfig): MCPToolFilterCallable {
  const { allow, block = [], afterApprove = [] } = tools;
  return async ({ runContext }, tool) => {
    if (allow && !allow.includes(tool.name)) return false;
    if (block.includes(tool.name)) return false;
    if (afterApprove === "*" || afterApprove.includes(tool.name)) {
      return Boolean((runContext.context as CoachContext | undefined)?.approvedPlan);
    }
    return true;
  };
}

// cacheToolsList выключен намеренно: SDK кэширует список tools уже после toolFilter, и при кэше
// скрытые до approve tools так и остались бы скрытыми на шаге сохранения.
const toStdioServer = (config: McpServerConfig) =>
  new MCPServerStdio({
    name: config.name,
    command: config.command,
    args: config.args,
    env: config.env,
    cwd: process.cwd(),
    cacheToolsList: false,
    toolFilter: configToolFilter(config),
  });

export type ConnectedServers = { active: MCPServer[]; close: () => Promise<void> };

// Поднимает серверы параллельно. Сервер, который не стартовал (нет сети для npx, нет каталога), отбрасывается
// с предупреждением: запуск агента продолжается без его tools. Закрыть обязан вызывающий: close().
export async function connectServers(configs: McpServerConfig[]): Promise<ConnectedServers> {
  const servers = await connectMcpServers(configs.map(toStdioServer), { dropFailed: true, connectInParallel: true });
  for (const [server, error] of servers.errors) {
    console.warn(`MCP-сервер ${server.name} не запустился, его tools недоступны: ${error.message}`);
  }
  console.log(`MCP-серверы: ${servers.active.map((server) => server.name).join(", ") || "нет"}`);
  return { active: servers.active, close: () => servers.close() };
}

// Текст ресурса (например, plans://latest). Ресурсы читает harness, модели они не передаются.
export async function readResource(server: MCPServer, uri: string): Promise<string> {
  if (!("readResource" in server) || typeof server.readResource !== "function") throw new Error(`MCP-сервер ${server.name} не отдаёт resources.`);
  const { contents } = await server.readResource(uri);
  return contents.map((item: object) => ("text" in item && typeof item.text === "string" ? item.text : "")).join("\n");
}
