import { join } from "node:path";

// Реестр MCP-серверов коуча. Подключить готовый сервер = добавить сюда запись: harness поднимает все
// включённые серверы и отдаёт их tools коучу одним списком, правки кода не нужны (src/mcp/servers.ts).
//
// Guardrails здесь — «стена»: что сервер вообще может (аргументы запуска, env) и какие его tools видит
// коуч и когда. Промпт коуча (prompts/healthCoach.v4.md) — только «просьба» поверх этой стены.

export type McpServerConfig = {
  // Источник tool-а, kebab-case: SDK показывает модели имена вида mcp_<name>__<tool> (с «_» вместо «-»:
  // mcp_markdown_health__read_profile), UI — метку [name].
  name: string;
  command: string;
  args: string[];
  // Дочерний процесс получает только безопасный минимум env (PATH, APPDATA…) плюс эти переменные:
  // ключ DeepSeek и прочее содержимое .env в серверы не попадает.
  env?: Record<string, string>;
  enabled: boolean;
  // Какие tools сервера видит коуч. Имена — исходные, как их публикует сервер (без префикса).
  tools?: {
    allow?: string[]; // только эти; по умолчанию все
    block?: string[]; // никогда
    afterApprove?: string[] | "*"; // только после approve ревьюера: на шаге сохранения или по кнопке
  };
  // Сервер не поднимается в обычном запуске агента: пользователь вызывает его кнопкой под одобренным
  // планом. task — поручение коучу, план harness дописывает сам.
  button?: { label: string; task: string };
};

// Сервер данных пользователя: harness читает через него plans://latest и сверяет сохранённый план.
export const DATA_SERVER = "markdown-health";

// Серверы запускаются из корня репозитория: от него наш сервер ищет data/, а filesystem — относительные пути.
const ROOT = process.cwd();

export const MCP_SERVERS: McpServerConfig[] = [
  {
    // Наш сервер: профиль, дневник, рецепты, сохранение плана. Node запускает .ts напрямую.
    name: "markdown-health",
    command: process.execPath,
    args: [join(ROOT, "src", "mcp", "markdownHealthServer.ts")],
    enabled: true,
    tools: { block: ["append_daily_log"], afterApprove: ["save_health_plan"] },
  },
  {
    // Официальный filesystem-сервер. Стена — список каталогов в аргументах: только data/ и plans/,
    // выше корня проекта и в соседние каталоги сервер не пустит. Пишет только после approve.
    name: "filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem@2026.8.31", join(ROOT, "data"), join(ROOT, "plans")],
    enabled: true,
    tools: { afterApprove: "*" },
  },
  {
    // Прогноз MET Norway (данные yr.no) через Open-Meteo, без ключа. Read-only по природе, поэтому без гейта;
    // из 17 tools сервера коучу нужен один.
    name: "weather",
    command: "npx",
    args: ["-y", "open-meteo-mcp-server@2.5.0"],
    enabled: true,
    tools: { allow: ["metno_forecast"] },
  },
  {
    // Официальный Notion MCP с internal integration token, без OAuth. Включается сам, когда в .env есть
    // NOTION_TOKEN. Стена — права integration: в Notion ей выдана только страница «Wellness».
    name: "notion",
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server@2.5.2"],
    env: { NOTION_TOKEN: process.env.NOTION_TOKEN ?? "" },
    enabled: Boolean(process.env.NOTION_TOKEN),
    tools: { afterApprove: "*", block: ["API-delete-a-block", "API-move-page"] },
    button: {
      label: "Сохранить в Notion",
      task: "Сохрани одобренный план ниже новой страницей в Notion внутри страницы «Wellness». Заголовок страницы — «План от <сегодняшняя дата>».",
    },
  },
];
