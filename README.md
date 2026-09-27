# Health Coach Agent

Health Coach Agent + Safety Reviewer Agent (до 3 раундов ревизии) на OpenAI Agents SDK и DeepSeek, обёрнутые в Next.js (App Router).

## Запуск

`.env` в корне:

```
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com   # опционально
DEEPSEEK_MODEL=deepseek-v4-flash             # опционально
NOTION_TOKEN=ntn_...                         # опционально: включает Notion MCP (см. ниже)
SUPABASE_DB_URL=postgresql://...             # база знаний (RAG, см. ниже)
EMBEDDING_API_KEY=sk-...                     # ключ OpenAI-compatible провайдера embeddings
EMBEDDING_BASE_URL=https://api.openai.com/v1 # опционально
EMBEDDING_MODEL=text-embedding-3-small       # опционально; размерность должна быть 1536
```

Без `SUPABASE_DB_URL` и `EMBEDDING_API_KEY` агент работает, но `searchKnowledge` возвращает модели ошибку, и план строится без базы знаний.

Внешние MCP-серверы (filesystem, погода) запускаются через `npx`: при первом запуске нужен интернет, пакеты скачаются в кэш npm.

```bash
npm install
npm run dev
```

Откройте http://localhost:3000, введите задачу, нажмите **Run Agent**. Одобренный план сохраняется в `data/output.md`.

## Структура

```
app/page.tsx                  UI: textarea, Run Agent, результат (idle / running / result)
app/layout.tsx                root layout App Router, шрифты Geist + Geist Mono
app/globals.css               Tailwind v4 + тема shadcn/ui (CSS-переменные, success/warning, .dark)
app/typeset.css               shadcn/typeset — типографика отрендеренного Markdown
app/api/agent/run/route.ts    POST { task } → { plan, review, rounds[], finalScore, improved, promptVersions, model, toolCalls, actions, durationMs }
app/api/agent/action/route.ts POST { server, plan } → действие по кнопке под одобренным планом (например, «Сохранить в Notion»)
app/dev/                      /dev (только dev): evals и replay из UI
app/api/dev/eval/route.ts     POST { id } → строка eval-кейса с полным результатом (только dev)
app/api/dev/replay/route.ts   POST { runId } → «было / стало» + полный результат (только dev)
components/agent-result.tsx   карточки результата (ревью, раунды, tools, план) — главная и /dev
components/ui/*               компоненты shadcn/ui (добавляются через `npx shadcn@latest add <name>`)
prompts/*.<версия>.md         тексты промптов коуча и ревьюера (активные версии — ACTIVE_PROMPTS; *.test-revise.md — тестовые)
components/markdown.tsx       рендер Markdown-плана (без dangerouslySetInnerHTML)
components/providers.tsx      next-themes (светлая / тёмная / системная тема) + TooltipProvider
components/theme-toggle.tsx   переключатель темы
src/agents/healthCoach.ts     агент-коуч: локальные tools + MCP-серверы из конфига (имена tools с префиксом сервера)
src/agents/safetyReviewer.ts  агент-ревьюер (без tools и побочных эффектов) и pre-check задачи
src/skills/*.ts               локальные tools коуча: searchKnowledge, suggestWorkoutTemplate, generateShoppingList
src/rag/                      RAG: chunking.ts (чанки по ##), embeddings.ts (fetch к /embeddings), db.ts (postgres), retriever.ts (searchKnowledge)
knowledge/*.md                база знаний: рецепты, правила питания, шаблоны тренировок, восстановление, учёт предпочтений
scripts/ingest.ts             npm run ingest: knowledge/*.md → embeddings → Supabase knowledge_chunks (очистить и залить заново)
supabase/migrations/          SQL-миграции Supabase (001_knowledge.sql — таблица knowledge_chunks и hnsw-индекс)
docs/*.sql                    документация схемы БД, файлы по порядку выполнения
src/mcp/servers.config.ts     реестр MCP-серверов: команда запуска, env, enabled, какие tools видит коуч и когда, кнопка
src/mcp/servers.ts            запуск серверов из конфига (MCPServerStdio), общий toolFilter, чтение resources
src/mcp/markdownHealthServer.ts наш MCP-сервер данных (stdio, отдельный процесс): read_profile, read_recent_logs, append_daily_log, save_health_plan, list_recipes + resources
src/harness/runHealthAgent.ts runHealthAgent(task, { maxRounds = 3, minRounds = 1, promptVersions }): оркестратор harness
src/harness/runServerAction.ts runServerAction(server, plan): действие по кнопке (сервер с полем button), только для одобренного плана
src/harness/coachRun.ts       общее для запуска и кнопки: настройка DeepSeek, запуск коуча, toolCalls, строка «Сегодня»
src/harness/validateReview.ts Zod-схема ревью, safe-parse, один ретрай на невалидный JSON
src/harness/rounds.ts         RoundState и история раундов
src/harness/score.ts          finalScore (последний approve) и improved
src/harness/promptVersions.ts ACTIVE_PROMPTS и загрузка prompts/<имя>.<версия>.md
src/harness/traceRun.ts       трейс каждого запуска → runs/run-<timestamp>.json
src/dev/replay.ts             список трейсов, replay и сравнение «было / стало» (для CLI и /dev)
src/dev/evals.ts              кейсы evals/cases/*.json, прогон и проверка PASS/FAIL (для CLI и /dev)
scripts/replay.ts             npm run replay <трейс>: CLI-обёртка над src/dev/replay.ts
scripts/eval.ts               npm run eval: CLI-обёртка над src/dev/evals.ts
scripts/mcp-inspect.ts        npm run mcp:inspect: поднимает включённые серверы из конфига и печатает их tools с пометками и resources
runs/run-example.json         пример трейса (остальные runs/* в .gitignore)
plans/                        планы, которые коуч по просьбе пользователя сохраняет через filesystem MCP (в .gitignore)
data/profile.md, data/log.md  профиль и дневник — коуч читает их через MCP (read_profile, read_recent_logs)
data/recipes.md               любимые рецепты (MCP: list_recipes)
data/output.md                последний одобренный план (MCP: save_health_plan)
data/shopping.md              последний список покупок (generateShoppingList)
```

UI собран на [shadcn/ui](https://ui.shadcn.com) (стиль `base-nova` на Base UI, Tailwind CSS v4, иконки lucide); настройки CLI — в `components.json`.

Промпты, pre-check и loop перенесены из V0 без изменений. Новая версия промпта — файл вида `prompts/healthCoach.v6.md` и правка `ACTIVE_PROMPTS` в `src/harness/promptVersions.ts`. Пути к `data/` считаются от `process.cwd()`, поэтому `npm run dev` запускается из корня репозитория.

## MCP: данные пользователя через стандартный сервер

Профиль, дневник, рецепты и сохранение плана коуч получает из собственного MCP-сервера `src/mcp/markdownHealthServer.ts` (MCP TypeScript SDK v2, транспорт stdio). Это отдельный процесс поверх тех же Markdown-файлов в `data/`. Готовые внешние серверы подключены рядом с ним, см. [«Внешние MCP-серверы»](#внешние-mcp-серверы-интеграция--конфиг-а-не-код). Сетевых транспортов нет, всё работает по stdio.

### До MCP / После MCP

| | До MCP | После MCP |
|---|---|---|
| Где живёт интеграция | Файл в `src/skills/` на каждый источник: свой `tool()`, своя zod-схема, свой `readFile` | Один сервер: `registerTool` / `registerResource` на каждый источник |
| Как агент получает tools | Руками: импорт каждой функции в массив `COACH_TOOLS` | `mcpServers: [new MCPServerStdio(...)]`, SDK сам делает `tools/list` и превращает ответ в function tools |
| Новый источник данных | Новый файл + правка агента | Новый `registerTool` в сервере; агент подхватит его без правок кода (нужна только строчка в промпте) |
| Кто ещё может пользоваться | Только этот агент в этом процессе | Любой MCP-клиент: `npm run mcp:inspect`, MCP Inspector, Claude Desktop, другой агент |
| Процесс | Тот же, что у Next.js | Отдельный: harness запускает его на время запуска и закрывает в `finally` |
| Что видно в трейсе | `getProfile`, `getRecentLog`, … | `read_profile`, `read_recent_logs`, … — в том же `toolCalls`, рядом с локальными |

Раньше каждая интеграция подключалась руками. Теперь данные отдаёт стандартный сервер, и подключение к нему выглядит одинаково для любого клиента.

### Что где осталось

- **MCP-tools** (данные): `read_profile`, `read_recent_logs(days)`, `list_recipes`, `save_health_plan(markdown)`, `append_daily_log(entry)`.
- **MCP-resources** (те же данные как адресуемые документы, их читает клиент, а не модель): `profile://me`, `logs://recent` (последние 7 записей), `recipes://all`, `plans://latest`.
- **Локальные tools** в `src/skills/`: `searchKnowledge` (база знаний, см. [RAG](#rag-база-знаний-в-supabase-pgvector)), `suggestWorkoutTemplate` и `generateShoppingList`. Для модели они ничем не отличаются от MCP-tools, в этом и смысл контраста. В UI у каждого tool есть метка источника: `[markdown-health]`, `[filesystem]`, `[weather]`, `[notion]` или `[local]`.
- **Harness** (решения, а не данные): цикл раундов, валидация ревью, score, гейт сохранения. Сервер не знает ни о вердиктах, ни об одобрении.

Гейт сохранения держит клиент. Общий `toolFilter` (`src/mcp/servers.ts`) по записи `tools.afterApprove` в конфиге скрывает `save_health_plan`, пока harness не положил в контекст `approvedPlan`. После шага сохранения harness читает `plans://latest` и сверяет его с одобренным планом. Если коуч tool не вызвал или исказил текст, harness сам вызывает `save_health_plan` через тот же сервер. `append_daily_log` сервер публикует, но коучу не отдаёт (`tools.block`): составляя план, он не должен менять дневник пользователя. У `MCPServerStdio` выключен `cacheToolsList`, потому что SDK кэширует список tools уже после фильтра, и `save_health_plan` остался бы скрытым навсегда.

Сервер запускается как `node src/mcp/markdownHealthServer.ts`: Node сам снимает типы, сборка и tsx не нужны. Поэтому файл самодостаточный и не импортирует ничего из `src/`. Pre-check срабатывает до запуска сервера, так что медицинский запрос процесс не порождает.

### Посмотреть на сервер

```bash
npm run mcp:inspect
```

Скрипт поднимает все включённые серверы из `src/mcp/servers.config.ts`, подключается к каждому стандартным MCP-клиентом (`@modelcontextprotocol/client`) и печатает tools с параметрами и resources. Имена tools выводятся так, как их видит модель, с пометками конфига: `[виден коучу]`, `[после approve]`, `[скрыт от коуча]`. DeepSeek и агент в этом не участвуют.

Для интерактивной проверки подойдёт [MCP Inspector](https://github.com/modelcontextprotocol/inspector): это клиент с веб-интерфейсом, он запускает наш stdio-сервер сам:

```bash
npx @modelcontextprotocol/inspector node src/mcp/markdownHealthServer.ts
```

Из корня репозитория: сервер ищет `data/` от текущего каталога. В Inspector можно вызвать любой tool, включая `append_daily_log` и `save_health_plan`. Они по-настоящему пишут в `data/`.

## Внешние MCP-серверы: интеграция = конфиг, а не код

Кроме нашего сервера коуч получает tools трёх готовых серверов. Ни строчки интеграции для них не написано: каждый — это запись в `src/mcp/servers.config.ts`. Harness поднимает все включённые серверы (`connectMcpServers` из `@openai/agents`, параллельно) и отдаёт их tools коучу одним списком вместе с локальными. Tools внешних серверов агент получает как есть, без обёрток.

| Сервер | Пакет | Что даёт коучу | Авторизация | По умолчанию |
|---|---|---|---|---|
| markdown-health | наш `src/mcp/markdownHealthServer.ts` | профиль, дневник, рецепты, сохранение плана | нет | включён |
| filesystem | [`@modelcontextprotocol/server-filesystem@2026.8.31`](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem) | запись плана в `plans/<дата>.md` (после approve) | нет | включён |
| weather | [`open-meteo-mcp-server@2.5.0`](https://www.npmjs.com/package/open-meteo-mcp-server) | `metno_forecast`: прогноз MET Norway (данные yr.no) по координатам | нет | включён |
| notion | [`@notionhq/notion-mcp-server@2.5.2`](https://www.npmjs.com/package/@notionhq/notion-mcp-server) | страница с планом в Notion — по кнопке | internal integration token (`NOTION_TOKEN`), без OAuth | только при `NOTION_TOKEN` |

Запись конфига: `{ name, command, args, env?, enabled, tools?, button? }`.
- `enabled: false` — сервер не запускается, его tools у коуча пропадают. У notion `enabled: Boolean(process.env.NOTION_TOKEN)`: без токена он молча пропускается.
- `tools.allow` / `tools.block` — какие tools сервера коуч видит вообще.
- `tools.afterApprove` — какие tools появляются только после approve ревьюера (`"*"` — все).
- `button` — сервер не участвует в запуске агента, а доступен кнопкой под одобренным планом.

Модель видит MCP-tools с префиксом сервера (`mcpConfig.includeServerInToolNames` в SDK): `mcp_weather__metno_forecast`, `mcp_filesystem__write_file`. Так имена разных серверов не конфликтуют, а в `toolCalls`, трейсе `runs/*.json` и UI сразу виден источник. SDK заменяет `-` на `_` в обеих частях имени: `markdown-health` → `mcp_markdown_health__…`, `API-post-page` → `API_post_page`. Поэтому имена серверов в конфиге — kebab-case без `_`.

Если сервер выключен или не стартовал (например, `npx` без сети), запуск продолжается без него: сервер отбрасывается с предупреждением в логе (`dropFailed`). Если модель всё же вызовет tool отсутствующего сервера (промпт про него знает), SDK вернёт ей ошибку вместо падения (`toolNotFoundBehavior: "return_error_to_model"`). Коуч тогда пишет в плане, каких данных не хватило. В `toolCalls` такой вызов не попадает, только в лог.

### Guardrails: промпт — просьба, конфиг — стена

Промпт коуча (`prompts/healthCoach.v4.md`) говорит, *как надо* пользоваться tools. Модель может ошибиться или её можно уговорить. Конфиг и права на стороне сервера определяют, *что вообще возможно*, и модель их не обойдёт. Поэтому каждое опасное действие закрыто на двух уровнях:

| Сервер | Стена (конфиг и права) | Просьба (промпт v4) |
|---|---|---|
| filesystem | Аргументы запуска: разрешены только каталоги `data/` и `plans/` проекта, выше корня и в соседние каталоги сервер не пустит. `afterApprove: "*"`: до одобрения плана у коуча нет ни одного tool этого сервера. | Писать только в `plans/<дата>.md` и только по просьбе пользователя, `data/` не трогать |
| notion | Права internal integration: в Notion ей выдана только страница «Wellness», остальное API не покажет. Сервер «по кнопке»: в обычном запуске не поднимается, пишет только по явному выбору пользователя и только одобренный план (harness сверяет текст с `plans://latest`). `block`: `API-delete-a-block`, `API-move-page`. | Создавать страницу только внутри «Wellness», чужие страницы не читать и не менять |
| weather | Не нужна: сервер только читает открытый прогноз, ключа нет, побочных эффектов нет. `allow: ["metno_forecast"]` лишь сужает 17 tools до одного, нужного коучу. | Для активности на улице смотреть прогноз; при дожде, ветре или морозе переносить нагрузку под крышу и ссылаться на прогноз |
| markdown-health | `afterApprove: ["save_health_plan"]`, `block: ["append_daily_log"]` | Сохранять план дословно и только когда попросят |

Не все серверы одинаково опасны. Погоде хватает честного описания в промпте, а файлам и Notion нужна стена, потому что они пишут. Ещё одна стена действует для всех: дочерний процесс MCP получает только безопасный минимум переменных окружения (`PATH`, `APPDATA`…) плюс `env` из своей записи. `DEEPSEEK_API_KEY` и прочее содержимое `.env` в серверы не попадает, `NOTION_TOKEN` видит только notion.

Правило в промпте — не стена: `data/` в filesystem остаётся доступным, потому что так задано в требованиях. Если коуч ошибётся, он сможет записать туда. Стена здесь — «только после approve» и «только внутри проекта».

### Почему прогноз от Open-Meteo, а не `@pipeworx/mcp-met-no`

Сначала планировался `@pipeworx/mcp-met-no@0.1.2`, других MCP-пакетов именно для yr.no в npm нет. Он запускается через `npx` по stdio и ходит в api.met.no без ключа. Но его `forecast(lat, lon)` отдаёт сырой 10-дневный прогноз: около 80 000 символов на вызов, и параметров, чтобы сузить ответ, нет. Резать ответ своей обёрткой значило бы нарушить принцип «tools как есть».

`open-meteo-mcp-server` отдаёт те же модели MET Norway (`metno_seamless`: MET Nordic на первые дни, дальше смесь с ECMWF) через tool `metno_forecast`. Размер ответа задаётся запросом: `daily`, `start_date`/`end_date`, `timezone`. Дневная сводка на неделю по Гётеборгу — около 700 символов, а встроенный лимит сервера 25 000 символов страхует от слишком широкого запроса.

Координаты в коде не зашиты: коуч берёт их из поля «Город» в `data/profile.md`. Текущую дату harness передаёт строкой «Сегодня: …» во входе коуча, иначе модель не посчитает «завтра».

### Демо

Все три запускаются из UI или через `POST /api/agent/run`:

- **Погода.** «Спланируй тренировку на завтра с учётом погоды». В трейсе есть `mcp_weather__metno_forecast`, в разделе «Активность» план ссылается на прогноз (температура, осадки, ветер) и переносит нагрузку на скалодром в дождливые дни.
- **Файл.** «…и сохрани мой план ещё в отдельный файл plans/<дата>.md». После approve коуч вызывает `mcp_filesystem__list_allowed_directories` и `mcp_filesystem__write_file`, в `plans/` появляется файл. До approve filesystem-tools у коуча нет. Относительный путь сервер считает от первого разрешённого каталога (`data/`), поэтому промпт просит полный путь `plans` из `list_allowed_directories`.
- **Notion** (при `NOTION_TOKEN`). Под одобренным планом появляется кнопка «Сохранить в Notion». Коуч получает только tools notion и создаёт страницу внутри «Wellness». Без токена кнопки нет, процесс notion не запускается.

Выключите любой сервер (`enabled: false`) — его tools пропадут у коуча, запуск пройдёт без ошибок. `npm run mcp:inspect` покажет, что осталось.

### Настройка Notion

1. На https://www.notion.so/profile/integrations создайте **internal integration** (без OAuth) и скопируйте её токен.
2. В Notion создайте страницу «Wellness», откройте меню `•••` → **Connections** и добавьте интеграцию. Другие страницы ей не давайте: это и есть стена.
3. Добавьте `NOTION_TOKEN=ntn_...` в `.env` и перезапустите `npm run dev`.

### Как добавить сервер

Новая запись в `MCP_SERVERS`: `name` (kebab-case), `command` и `args` (обычно `npx -y <пакет>@<версия>`), при необходимости `env`, `tools` и `button`. Код harness не меняется. Чтобы коуч вызывал новые tools осознанно, добавьте строчку в новую версию промпта.

### Ещё полезные MCP (не подключены)

- **Google Calendar** — ставить тренировки в календарь. Требует OAuth-флоу, поэтому вынесен за скобки: в проекте разрешены только токены из `.env`.
- **Database** (например, Postgres или SQLite MCP) — хранить дневник и планы в базе вместо Markdown.
- **Web Search** (например, Brave Search или Tavily MCP, ключ API) — искать рецепты и информацию о продуктах.

## RAG: база знаний в Supabase pgvector

Коуч ищет в базе знаний `knowledge/*.md` (рецепты, правила питания, шаблоны тренировок, правила восстановления, правила учёта предпочтений) через локальный tool `searchKnowledge`. Это простой RAG без фреймворков: один embedding запроса, один similarity search в pgvector, прямой SQL через драйвер `postgres` и `fetch` к embeddings API. Reranking, hybrid search и переписывания запроса нет.

```
knowledge/*.md ──npm run ingest──▶ чанки по «##» ──embeddings──▶ knowledge_chunks (Supabase, vector(1536))
коуч ──searchKnowledge(query)──▶ embed(query) ──order by embedding <=> query limit 5──▶ секции с file › heading
```

- **Чанкинг** (`src/rag/chunking.ts`): 1 секция `## …` = 1 чанк с метаданными `file`, `heading`. В embedding идут заголовок и тело.
- **Embeddings** (`src/rag/embeddings.ts`): `POST <EMBEDDING_BASE_URL>/embeddings` через `fetch`, по умолчанию OpenAI `text-embedding-3-small` (1536). У DeepSeek embeddings нет, поэтому провайдер отдельный.
- **Retriever** (`src/rag/retriever.ts`): `searchKnowledge(query, topK = 5)` → `{ file, heading, content, similarity }[]`, где `similarity = 1 − косинусное расстояние`.
- **Tool** (`src/skills/knowledge.ts`): отдаёт модели найденные секции с источником. Если база недоступна (нет ключа, БД), модель получает ошибку текстом и запуск продолжается.
- **Промпт** `healthCoach.v5`: сначала искать в базе знаний, блюда брать только из `searchKnowledge` или `list_recipes` и указывать источник `(база знаний: recipes.md › …)`.
- **Трейс и UI**: каждый вызов пишет `{ query, chunks: [{ file, heading, similarity }] }` в `retrievals` результата и трейса. В «Что сделал агент» он показывается как `🔍 knowledge: <query> → N chunks` с заголовками найденных чанков.

### Настройка

1. Создайте проект в [Supabase](https://supabase.com) и выполните `supabase/migrations/001_knowledge.sql` в SQL Editor (или `supabase db push`). Схема задокументирована в `docs/001_create_knowledge_chunks_table.sql`.
2. Добавьте в `.env` `SUPABASE_DB_URL` (Dashboard → Connect → connection string, подойдёт и pooler) и `EMBEDDING_API_KEY`.
3. Залейте базу знаний:
   ```bash
   npm run ingest
   ```
   Ингест идемпотентен: сначала считает все embeddings, затем в одной транзакции делает `truncate` и заливает чанки заново. Повторный запуск не создаёт дублей, а удалённые секции исчезают из базы. После правки `knowledge/*.md` запустите ингест снова.

### Ограничение: отрицания в запросе

Векторный поиск не понимает «без». На запрос «ужин с высоким белком без молочки» в top-5 попадают правила про молочные продукты и рецепт творога: слово «молочки» делает их близкими по смыслу. Ни одного ужина в выдаче при этом нет. Выручает сам коуч: промпт v5 просит искать конкретно, и следующим запросом («высокобелковый ужин из рыбы или курицы без молочных продуктов, рецепт») он получает 4 подходящих рецепта. Молочное блюдо он отбраковывает сам по тегу «содержит молочное». Обычно такое лечат reranking или hybrid search (BM25 + векторы). В этом учебном RAG их намеренно нет. Эксперимент без изменения поиска: если в embedding рецепта отдавать только заголовок и теги, а в базе хранить полный текст, на запрос про ужин находятся 3 подходящих рецепта в top-4 вместо одного. Творог при этом всё равно остаётся в выдаче.

### Memory vs RAG

`profile.md` и `log.md` — личная память агента: они отвечают на вопрос «кто ты» (параметры, цели, график, как прошли последние дни), принадлежат одному пользователю и меняются вместе с ним. Коуч читает их через MCP-сервер `markdown-health` как есть, без поиска по смыслу. `knowledge/` — база знаний: она отвечает на вопрос «что мы умеем» (рецепты, правила питания, шаблоны тренировок, восстановление) и одинакова для всех пользователей. Целиком в промпт она не подставляется: лежит в pgvector, и коуч по запросу достаёт только несколько релевантных секций. Память уточняет знания: если в профиле «без молочки», коуч ищет в базе «ужин с высоким белком без молочки», а при конфликте побеждает профиль. Личные данные при этом в pgvector не переносятся: их нужно читать целиком и точно, а не «похожими кусками».

## Тестовый режим (только dev)

В dev-режиме `POST /api/agent/run` принимает `minRounds` и `prompts: { coach?, reviewer? }`, а UI берёт их из URL. Сценарий revise → approve:

```
http://localhost:3000/?coach=test-revise&reviewer=test-revise
```

Тестовый коуч намеренно пропускает раздел «Ограничения безопасности» в первом черновике, тестовый ревьюер возвращает на это `revise`. `?minRounds=2` не даёт approve завершить цикл раньше второго раунда. В production эти параметры отклоняются с 400.

## Как дебажить агента

Цикл: **trace → replay → eval**. Всё локально, в JSON-файлах; скрипты запускаются через `tsx` без сборки и читают `.env` из корня.

То же самое доступно в UI: `http://localhost:3000/dev` (ссылка «Dev» в шапке, только в dev-режиме). Evals запускаются по одному кейсу или все подряд (строки заполняются по мере прогона), replay — из списка трейсов `runs/`; для каждого прогона видны раунды, замечания, вызванные tools и план. Одновременно идёт только один прогон. В production `/dev` и `/api/dev/*` отвечают 404.

1. **Trace.** Каждый завершённый запуск (из UI, replay или eval) пишет `runs/run-<timestamp>.json`: задача, версии промптов, модель, раунды (первые 500 символов плана + ревью), toolCalls, retrievals (запросы к базе знаний и заголовки найденных чанков), finalScore, verdict, durationMs. Формат — в `runs/run-example.json`. Запуск, упавший с ошибкой, трейса не оставляет; ошибка записи трейса только логируется и не роняет запуск.
2. **Replay.** Поправили промпт, `ACTIVE_PROMPTS` или `DEEPSEEK_MODEL` — повторите ту же задачу текущим harness:
   ```bash
   npm run replay runs/run-XXX.json
   ```
   Скрипт печатает таблицу «было / стало» по verdict, finalScore, раундам, toolCalls, promptVersions и модели; изменившиеся строки помечены `≠`. Новый прогон тоже сохраняется в `runs/`.
3. **Eval.** Перед тем как оставить правку, прогоните кейсы из `evals/cases/*.json` (последовательно, реальные вызовы DeepSeek):
   ```bash
   npm run eval
   ```
   Кейс — `{ name, task, expect: { verdict, minScore?, toolCalls? } }`; `toolCalls` — tools, которые агент обязан вызвать (`knowledge-based-recipe` проверяет, что был retrieval через `searchKnowledge`). `bad-medical-request` проверяет safety gate: он проходит, только если агент остановился с `needs_human_professional` и не вернул план. При любом FAIL код выхода 1; трейс упавшего кейса можно отдать в replay.

## Почему удалён `index.ts`

Старый CLI (`index.ts`) удалён: приложение работает только через веб-интерфейс, единственная точка входа для задач пользователя — `POST /api/agent/run`, так логика не дублируется и не расходится между CLI и вебом. `tsx` вернулся только для dev-скриптов `replay` и `eval`: они, как и страница `/dev`, используют общую логику из `src/dev/` и тот же `runHealthAgent`. Логи раундов пишутся в консоль сервера `next dev`.
