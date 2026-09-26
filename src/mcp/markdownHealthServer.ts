// MCP-сервер данных пользователя поверх Markdown-файлов в data/ (MCP TypeScript SDK v2, @modelcontextprotocol/server).
// Отдельный процесс, транспорт stdio: harness запускает его на время запуска агента (запись в src/mcp/servers.config.ts),
// npm run mcp:inspect — для демо.
//
// Запускается напрямую через `node src/mcp/markdownHealthServer.ts` (Node сам снимает типы), поэтому файл
// самодостаточный: без импортов из src/ и без TS-синтаксиса, которому нужна компиляция (enum и т.п.).
// stdout занят протоколом MCP — диагностику пишем только в stderr.
//
// Здесь только данные: чтение и запись файлов. Решения — когда можно сохранять план, одобрен ли он,
// какой у него score — принимает harness, сервер о них ничего не знает.
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

// cwd задаёт тот, кто запускает сервер: harness и mcp:inspect передают корень репозитория.
const DATA_DIR = join(process.cwd(), "data");
const PROFILE_PATH = join(DATA_DIR, "profile.md");
const LOG_PATH = join(DATA_DIR, "log.md");
const RECIPES_PATH = join(DATA_DIR, "recipes.md");
const PLAN_PATH = join(DATA_DIR, "output.md");

const MAX_DAYS = 14;
const RECENT_LOG_DAYS = 7;

const normalize = (markdown: string) => markdown.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();

// Дневник — Markdown, где каждый день начинается с «## <дата>», записи идут от старых к новым.
// «Последние N дней» — это последние N таких записей: даты в файле без года, считать от сегодняшнего дня нельзя.
async function readRecentLog(days: number): Promise<string> {
  const text = (await readFile(LOG_PATH, "utf8")).replace(/\r\n/g, "\n");
  const [, ...entries] = text.split(/^(?=## )/m);
  if (!entries.length) return "Дневник пуст: записей по дням нет.";
  const recent = entries.slice(-days).map((entry) => entry.trim());
  const note = recent.length < days ? `В дневнике только ${recent.length} дн. — возвращаю все.\n\n` : "";
  return `${note}${recent.join("\n\n")}`;
}

// Заголовок в формате дневника: «## 26 сентября, суббота».
function todayHeading(): string {
  const parts = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", weekday: "long" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `## ${part("day")} ${part("month")}, ${part("weekday")}`;
}

async function appendDailyLog(entry: string): Promise<string> {
  const body = normalize(entry);
  if (!body) return "Ошибка: пустая запись, дневник не изменён.";
  const block = body.startsWith("## ") ? body : `${todayHeading()}\n${body}`;
  const current = await readFile(LOG_PATH, "utf8").catch(() => "");
  const separator = !current || current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  await appendFile(LOG_PATH, `${separator}${block}\n`, "utf8");
  return `Запись добавлена в конец data/log.md:\n\n${block}`;
}

async function savePlan(markdown: string): Promise<string> {
  const text = normalize(markdown);
  if (!text) return "Ошибка: пустой план, data/output.md не изменён.";
  await writeFile(PLAN_PATH, `${text}\n`, "utf8");
  return "ok";
}

const readPlan = () => readFile(PLAN_PATH, "utf8").catch(() => "План ещё не сохранён: data/output.md отсутствует.");

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

const server = new McpServer({ name: "markdown-health", version: "1.0.0" });

// ---- Tools: действия, которые модель вызывает сама. Описания — часть интерфейса для модели.

server.registerTool(
  "read_profile",
  {
    title: "Профиль пользователя",
    description:
      "Возвращает профиль пользователя (Markdown из data/profile.md): имя, возраст, рост и вес, работа и распорядок дня, " +
      "уровень активности, цели на ближайшие месяцы, ограничения по времени и инвентарю, пищевые предпочтения, " +
      "привычки по кофе и чаю, желаемый формат рекомендаций. " +
      "Вызывай в начале почти любой задачи о плане: без профиля нельзя подобрать калорийность, граммовки, время и нагрузку. " +
      "Параметров нет. Данные не меняются в течение запроса — одного вызова достаточно.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  },
  async () => text(await readFile(PROFILE_PATH, "utf8")),
);

server.registerTool(
  "read_recent_logs",
  {
    title: "Дневник за последние дни",
    description:
      "Возвращает последние записи дневника пользователя (data/log.md), по одной на день, от старых к новым: " +
      "время отбоя и подъёма, приёмы пищи со временем и граммовками, тренировки, шаги, вода, самочувствие. " +
      "Вызывай, когда план должен учитывать фактическое поведение: запрос «с учётом лога/дневника», план питания, " +
      "сон и режим, корректировка нагрузки. Для плана на день обычно хватает 3 дней, для плана на неделю — 7. " +
      "Если записей меньше, чем запрошено, вернутся все имеющиеся.",
    inputSchema: z.object({
      days: z.number().int().min(1).max(MAX_DAYS).describe(`Сколько последних дней дневника вернуть, от 1 до ${MAX_DAYS}.`),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ days }) => text(await readRecentLog(days)),
);

server.registerTool(
  "append_daily_log",
  {
    title: "Добавить запись в дневник",
    description:
      "Добавляет запись о дне в конец дневника пользователя (data/log.md); существующие записи не меняются. " +
      "Запись — Markdown в формате дневника: сон, еда, тренировка, шаги, вода, самочувствие списком. " +
      "Если запись не начинается с заголовка «## <дата>», сервер добавит заголовок с сегодняшней датой. " +
      "Вызывай, только когда пользователь явно просит записать что-то в дневник.",
    inputSchema: z.object({
      entry: z.string().min(1).describe("Текст записи в Markdown, например «- Сон: 23:30 → 07:30\\n- Шаги: 9 000»."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ entry }) => text(await appendDailyLog(entry)),
);

server.registerTool(
  "save_health_plan",
  {
    title: "Сохранить план",
    description:
      "Сохраняет план, одобренный Safety Reviewer, в data/output.md (файл перезаписывается). " +
      "Доступен только после одобрения ревьюером. Передай план дословно, без единой правки: " +
      "сохранённый текст сверяется с одобренной версией. Возвращает ok или описание ошибки.",
    inputSchema: z.object({
      markdown: z.string().describe("Полный текст одобренного плана в Markdown, дословно."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  async ({ markdown }) => text(await savePlan(markdown)),
);

server.registerTool(
  "list_recipes",
  {
    title: "Любимые рецепты",
    description:
      "Возвращает любимые рецепты пользователя (Markdown из data/recipes.md): название, приём пищи, время приготовления, " +
      "ингредиенты с граммовками, примерные КБЖУ на порцию и короткие шаги. " +
      "Вызывай, когда составляешь план питания или меню: опирайся на эти блюда вместо придуманных, " +
      "подгоняя граммовки под цель. Особенно полезно для завтрака — у пользователя на него около 15 минут. " +
      "Параметров нет.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  },
  async () => text(await readFile(RECIPES_PATH, "utf8")),
);

// ---- Resources: те же данные как адресуемые документы. Их читает клиент (harness, Inspector), а не модель.

const markdownResource = (name: string, uri: string, title: string, description: string, read: () => Promise<string>) =>
  server.registerResource(name, uri, { title, description, mimeType: "text/markdown" }, async (url) => ({
    contents: [{ uri: url.href, mimeType: "text/markdown", text: await read() }],
  }));

markdownResource("profile", "profile://me", "Профиль", "data/profile.md целиком.", () => readFile(PROFILE_PATH, "utf8"));
markdownResource("recent-logs", "logs://recent", "Дневник: последние записи",
  `Последние ${RECENT_LOG_DAYS} записей data/log.md.`, () => readRecentLog(RECENT_LOG_DAYS));
markdownResource("recipes", "recipes://all", "Рецепты", "data/recipes.md целиком.", () => readFile(RECIPES_PATH, "utf8"));
markdownResource("latest-plan", "plans://latest", "Последний сохранённый план", "data/output.md: последний одобренный план.", readPlan);

await server.connect(new StdioServerTransport());
console.error(`markdown-health MCP-сервер запущен (stdio), данные: ${DATA_DIR}`);
