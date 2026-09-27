# Чат со стримингом и живыми статусами этапов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить форму на главной чатом на AI SDK: таймлайн этапов и tool calls оживает по ходу запуска агента, одобренный план стримится дельтами, внизу — verdict / score; при `needs_human_professional` — карточка «Требуется специалист».

**Architecture:** `runHealthAgent` получает опциональный `onEvent` и только эмитит события (хуки Agents SDK на экземпляре коуча + строки `emit` вокруг коуча, ревьюера и сохранения). Новый route `app/api/chat/route.ts` через `createUIMessageStream` переводит события в части `data-stage` / `data-tool` с постоянными id (AI SDK обновляет их на клиенте), после завершения harness проигрывает готовый план `text-delta`-ами и пишет `data-result`. `app/page.tsx` — чат на `useChat`, рендер в `components/chat/`.

**Tech Stack:** Next.js 16 (App Router), React 19.3, TypeScript, `@openai/agents` 0.18, AI SDK 7 (`ai`, `@ai-sdk/react` 4), shadcn/ui на Base UI (`components/ui`), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-27-chat-streaming-design.md`

## Global Constraints

- Весь пользовательский текст, логи и ошибки — по-русски.
- Harness не переписывать: в `src/harness/runHealthAgent.ts` только вставки эмиссии событий; `HealthAgentResult`, трейсы, логи и цикл раундов не меняются.
- Без `onEvent` поведение `runHealthAgent` прежнее: `/api/agent/run`, `npm run eval`, replay и `/dev` работают без изменений.
- Никаких новых UI-библиотек: только `components/ui`, Tailwind-утилиты и токены темы (`--success`, `--warning`, `--rag`, `--mcp`).
- Никакого персиста истории чата (ни БД, ни localStorage), один чат, без multi-conversation логики.
- Тесты и TDD не пишутся (требование пользователя): каждая задача проверяется `npx tsc --noEmit`, одноразовыми скриптами (не коммитятся) и ручной проверкой через `curl` / браузер.
- Зависимости: `ai@^7`, `@ai-sdk/react@^4`.
- Клиентский код импортирует из `src/` только типы.
- Git: работаем в текущей ветке `optimizing-ui`; каждое сообщение коммита заканчивается строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Клиент ушёл посреди запуска** (закрыл вкладку, `curl --max-time`): harness дорабатывает до конца (план сохранён, трейс записан), в логе сервера нет необработанных ошибок от записи в закрытый стрим. → Task 3, Step 7.
2. **Ошибка агента посреди запуска** (не найден промпт, упал DeepSeek, невалидный JSON ревьюера после ретрая): активные строки таймлайна становятся `error`, чат показывает Alert с русским текстом, инпут снова доступен. → Task 3, Step 6; Task 5, Step 5.
3. **Параллельные вызовы tools в одном ходе** (три `searchKnowledge` сразу, чередование с `read_profile`): у каждого вызова своя строка, этап закрывается только когда закончились все его tools. → Task 2, Step 5.
4. **Проигрывание плана не должно менять текст**: склейка дельт байт-в-байт равна плану (переводы строк, таблицы, отступы списков), иначе ломается Markdown. → Task 3, Step 4.
5. **Второе сообщение после первого (и после ошибки)** — независимый запуск: прошлые сообщения не меняются, части нового сообщения (с теми же id `r1-*`) не смешиваются со старыми. → Task 5, Step 6.

---

## File Structure

| Файл | Действие | Ответственность |
|---|---|---|
| `src/harness/events.ts` | create | Тип `HealthAgentEvent`, `OnEvent`, `safeEmit`, `emitToolEvents` (хуки SDK) |
| `src/harness/runHealthAgent.ts` | modify | `RunOptions.onEvent`, вставки `emit(...)` |
| `src/chat/messages.ts` | create | Типы `HealthChatMessage`, `StageData`, `ToolData`, `ResultData` |
| `src/chat/timeline.ts` | create | `createTimeline(writer)`: события → `data-stage` / `data-tool` |
| `src/chat/streamPlan.ts` | create | `planDeltas`, `streamPlan`: план → `text-*` чанки |
| `app/api/agent/test-options.ts` | create | `parseTestOptions` (перенос из run route) |
| `app/api/agent/run/route.ts` | modify | Импорт `parseTestOptions` вместо локальной функции |
| `app/api/chat/route.ts` | create | Стриминговый route чата |
| `components/agent-result.tsx` | modify | Экспорт `ToolCallRow`, `PlanActionButton`, `CopyButton`; новая `describeTool` |
| `components/chat/timeline.tsx` | create | `buildTimeline`, `Timeline` — этапы с вложенными tools |
| `components/chat/message.tsx` | create | `ChatMessage`: пузырь пользователя / ответ ассистента, итог, карточка специалиста |
| `app/page.tsx` | rewrite | Чат на `useChat`, композер, автоскролл |
| `CLAUDE.md` | modify | Описание чата, событий, `src/chat/` |
| `package.json`, `package-lock.json` | modify | `ai`, `@ai-sdk/react` |

---

### Task 1: События harness

**Files:**
- Create: `src/harness/events.ts`
- Modify: `src/harness/runHealthAgent.ts`

**Interfaces:**
- Consumes: `Agent` из `@openai/agents` (событие `agent_tool_start(context, tool, { toolCall })`, `agent_tool_end(context, tool, result, { toolCall })`), `CoachContext` из `src/agents/healthCoach.ts`, `Review` из `src/harness/validateReview.ts`.
- Produces:
  - `type CoachStep = number | "save"`
  - `type HealthAgentEvent` (union ниже), `type OnEvent = (event: HealthAgentEvent) => void`
  - `safeEmit(onEvent?: OnEvent): OnEvent`
  - `emitToolEvents(agent: Agent<CoachContext>, emit: OnEvent, currentStep: () => CoachStep): void`
  - `RunOptions.onEvent?: OnEvent` в `src/harness/runHealthAgent.ts`

- [ ] **Step 1: Создать `src/harness/events.ts`**

```ts
import type { Agent } from "@openai/agents";
import type { CoachContext } from "../agents/healthCoach";
import type { Review } from "./validateReview";

// События одного запуска runHealthAgent для живого UI (app/api/chat). Harness только сообщает, что происходит;
// что с этим делать — решает подписчик. Без onEvent события никуда не уходят и поведение прежнее.

// Шаг коуча: номер раунда или сохранение одобренного плана.
export type CoachStep = number | "save";

export type HealthAgentEvent =
  | { type: "coach_start"; round: number }
  | { type: "coach_end"; round: number }
  // name — как видела модель: mcp_<сервер>__<tool> или локальное имя; args — JSON-строка аргументов.
  | { type: "tool_start"; step: CoachStep; callId: string; name: string; args: string }
  | { type: "tool_end"; step: CoachStep; callId: string; name: string }
  | { type: "review_start"; round: number }
  // precheck: вердикт regex-фильтра до LLM (без review_start).
  | { type: "review_end"; round: number; review: Review; precheck: boolean }
  | { type: "save_start" }
  | { type: "save_end" };

export type OnEvent = (event: HealthAgentEvent) => void;

// Ошибка подписчика (например, запись в уже закрытый стрим) не должна ронять запуск агента.
export function safeEmit(onEvent?: OnEvent): OnEvent {
  return (event) => {
    if (!onEvent) return;
    try {
      onEvent(event);
    } catch (error) {
      console.error(`onEvent(${event.type}):`, error);
    }
  };
}

// Хуки SDK на экземпляре коуча, а не на глобальном runner: параллельные запуски не видят чужих tools.
// Срабатывают и в обычном run(). Вызовы отсутствующих tools хуков не дают — как и в toolCalls.
export function emitToolEvents(agent: Agent<CoachContext>, emit: OnEvent, currentStep: () => CoachStep) {
  agent.on("agent_tool_start", (_context, _tool, { toolCall }) => {
    if (toolCall.type !== "function_call") return;
    emit({ type: "tool_start", step: currentStep(), callId: toolCall.callId, name: toolCall.name, args: toolCall.arguments });
  });
  agent.on("agent_tool_end", (_context, _tool, _result, { toolCall }) => {
    if (toolCall.type !== "function_call") return;
    emit({ type: "tool_end", step: currentStep(), callId: toolCall.callId, name: toolCall.name });
  });
}
```

- [ ] **Step 2: Подключить события в `src/harness/runHealthAgent.ts`**

Импорт (после строки `import { configureDeepSeek, ... } from "./coachRun";`):

```ts
import { emitToolEvents, safeEmit, type CoachStep, type OnEvent } from "./events";
```

`RunOptions` — добавить поле после `promptVersions?: PromptVersions;`:

```ts
  // События для живого UI (app/api/chat): этапы, tools коуча, вердикты. Без него поведение прежнее.
  onEvent?: OnEvent;
```

В `runHealthAgent` сразу после `const actions = buttonServerConfigs()...;`:

```ts
  const emit = safeEmit(options.onEvent);
```

Pre-check — заменить блок:

```ts
  if (taskReview) {
    console.log(formatRound(history.record("", taskReview)));
    console.log("Запрос требует специалиста. План не сохранен.");
    return finish("", taskReview);
  }
```

на:

```ts
  if (taskReview) {
    console.log(formatRound(history.record("", taskReview)));
    emit({ type: "review_end", round: 1, review: taskReview, precheck: true });
    console.log("Запрос требует специалиста. План не сохранен.");
    return finish("", taskReview);
  }
```

В `runRounds` — заменить начало функции и тело цикла до проверки вердиктов:

```ts
    const coach = createHealthCoach(model, prompts.coach, servers);
    const dataServer = servers.find((server) => server.name === DATA_SERVER);
    for (let round = 1; round <= maxRounds; round += 1) {
      const coachRun = await askCoach(coach, task, history.last);
      toolCalls.push(...coachRun.toolCalls);
      retrievals.push(...coachRun.retrievals);
      const plan = coachRun.output;
      const review = await askReviewer(reviewer, task, plan);
      console.log(formatRound(history.record(plan, review)));
```

на:

```ts
    const coach = createHealthCoach(model, prompts.coach, servers);
    const dataServer = servers.find((server) => server.name === DATA_SERVER);
    // Шаг коуча для событий tools: номер раунда или сохранение. Без onEvent хуки не подписываются.
    let step: CoachStep = 1;
    if (options.onEvent) emitToolEvents(coach, emit, () => step);
    for (let round = 1; round <= maxRounds; round += 1) {
      step = round;
      emit({ type: "coach_start", round });
      const coachRun = await askCoach(coach, task, history.last);
      emit({ type: "coach_end", round });
      toolCalls.push(...coachRun.toolCalls);
      retrievals.push(...coachRun.retrievals);
      const plan = coachRun.output;
      emit({ type: "review_start", round });
      const review = await askReviewer(reviewer, task, plan);
      console.log(formatRound(history.record(plan, review)));
      emit({ type: "review_end", round, review, precheck: false });
```

Сохранение — заменить:

```ts
      if (review.verdict === "approve") {
        const saveRun = await savePlanByCoach(coach, dataServer, task, plan);
```

на:

```ts
      if (review.verdict === "approve") {
        step = "save";
        emit({ type: "save_start" });
        const saveRun = await savePlanByCoach(coach, dataServer, task, plan);
        emit({ type: "save_end" });
```

Больше в файле ничего не меняется.

- [ ] **Step 3: Проверка типов**

Run: `npx tsc --noEmit`
Expected: без ошибок. Если TS ругается на `toolCall.callId` / `toolCall.arguments` — проверь сужение `toolCall.type !== "function_call"` по `node_modules/@openai/agents-core/dist/types/protocol.d.ts` (тип `FunctionCallItem`).

- [ ] **Step 4: Проверка события pre-check (без LLM и без .env)**

Создать временный `scripts/_check-events.ts` (не коммитить):

```ts
import { runHealthAgent } from "../src/harness/runHealthAgent";

const result = await runHealthAgent("Какие таблетки пить от давления?", {
  onEvent: (event) => console.log("EVENT", JSON.stringify(event)),
});
console.log("VERDICT", result.review.verdict, "PLAN", JSON.stringify(result.plan));

// Подписчик, который бросает, не должен ронять запуск.
const again = await runHealthAgent("Какие таблетки пить от давления?", {
  onEvent: () => {
    throw new Error("подписчик упал");
  },
});
console.log("SURVIVED", again.review.verdict);
```

Run: `npx tsx scripts/_check-events.ts`
Expected:
```
EVENT {"type":"review_end","round":1,"review":{"verdict":"needs_human_professional","score":0,"issues":["Запрос касается медицинской темы: лекарств, симптомов, лечения или дозировок."]},"precheck":true}
VERDICT needs_human_professional PLAN ""
onEvent(review_end): Error: подписчик упал ...
SURVIVED needs_human_professional
```
(Плюс строки лога harness «Раунд 1: …», «Запрос требует специалиста…». Трейсы пишутся в `runs/` — он в .gitignore.)

Затем: `rm scripts/_check-events.ts`

- [ ] **Step 5: Commit**

```bash
git add src/harness/events.ts src/harness/runHealthAgent.ts
git commit -m "Harness: опциональный onEvent — события этапов и tools коуча

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: AI SDK, типы сообщений чата и таймлайн событий

**Files:**
- Modify: `package.json`, `package-lock.json` (через npm)
- Create: `src/chat/messages.ts`
- Create: `src/chat/timeline.ts`

**Interfaces:**
- Consumes: `HealthAgentEvent`, `CoachStep` из `src/harness/events.ts` (Task 1); `PlanAction`, `PromptVersions`, `Review` (типы, реэкспорт из `src/harness/runHealthAgent.ts`).
- Produces:
  - `src/chat/messages.ts`: `type StageKind = "profile" | "knowledge" | "writing" | "review" | "revising" | "final"`, `type Status = "active" | "done" | "error"`, `type StageData`, `type ToolData`, `type ResultData`, `type HealthChatMessage = UIMessage<never, { stage: StageData; tool: ToolData; result: ResultData }>`
  - `src/chat/timeline.ts`: `type ChatWriter = Pick<UIMessageStreamWriter<HealthChatMessage>, "write">`, `createTimeline(writer: ChatWriter): { handle(event: HealthAgentEvent): void; fail(): void }`
  - Id этапов: `r<N>-profile`, `r<N>-knowledge`, `r<N>-writing`, `r<N>-review`, `r<N>-revising`, `final`; id tool — `<id этапа>-<callId>`. У этапа `final` `round: 0`.

- [ ] **Step 1: Установить AI SDK**

Run: `npm install ai@^7 @ai-sdk/react@^4`
Expected: оба пакета в `dependencies`, без peer-ошибок (peer: react ^19.2.1, zod ^4.1.8).

- [ ] **Step 2: Сверить API с установленными типами**

Run:
```bash
grep -n "export declare function createUIMessageStream\b\|export declare function createUIMessageStreamResponse\|type UIMessageStreamWriter\|declare class DefaultChatTransport" node_modules/ai/dist/index.d.ts
grep -n "prepareSendMessagesRequest" node_modules/ai/dist/index.d.ts | head -5
```
Expected: все имена найдены. Если в 7.x что-то переименовано — используй актуальное имя во всех задачах ниже (сигнатуры: `createUIMessageStream({ execute({ writer }), onError(error): string })`, `writer.write({ type: "data-<name>", id, data })`, `writer.write({ type: "text-start" | "text-end", id })`, `writer.write({ type: "text-delta", id, delta })`, `createUIMessageStreamResponse({ stream })`, `new DefaultChatTransport({ api, prepareSendMessagesRequest({ messages, body }) { return { body } } })`).

- [ ] **Step 3: Создать `src/chat/messages.ts`**

```ts
import type { UIMessage } from "ai";
import type { PlanAction, PromptVersions, Review } from "../harness/runHealthAgent";

// Формат сообщений чата (app/api/chat → useChat). Сервер пишет части data-stage / data-tool с постоянным id
// и переписывает их по ходу запуска — AI SDK на клиенте заменяет часть с тем же id. Клиент импортирует
// отсюда только типы.

export type StageKind = "profile" | "knowledge" | "writing" | "review" | "revising" | "final";
export type Status = "active" | "done" | "error";

// Этап таймлайна. review и precheck — только у kind "review"; у "final" round = 0.
export type StageData = { kind: StageKind; round: number; status: Status; review?: Review; precheck?: boolean };

// Вызов tool коучем. name — как видела модель (mcp_<сервер>__<tool> или локальное имя), query — у searchKnowledge.
export type ToolData = { stageId: string; name: string; query?: string; status: Status };

// Итог запуска: пишется последней частью, UI показывает его под планом.
export type ResultData = {
  review: Review;
  approved: boolean;
  rounds: number;
  finalScore: number | null;
  improved: boolean;
  promptVersions: PromptVersions;
  model: string;
  durationMs: number;
  actions: PlanAction[];
};

export type HealthChatMessage = UIMessage<never, { stage: StageData; tool: ToolData; result: ResultData }>;
```

- [ ] **Step 4: Создать `src/chat/timeline.ts`**

```ts
import type { UIMessageStreamWriter } from "ai";
import type { CoachStep, HealthAgentEvent } from "../harness/events";
import type { HealthChatMessage, StageData, StageKind, ToolData } from "./messages";

// События runHealthAgent → части таймлайна чата. В раунде 1 tools разложены по смыслу: данные пользователя,
// поиск в базе знаний, всё остальное — генерация плана. С раунда 2 все tools раунда — в «Доработке»,
// tools шага сохранения — в «Итоговом плане». Каждое изменение пишется с тем же id, клиент обновляет строку.

export type ChatWriter = Pick<UIMessageStreamWriter<HealthChatMessage>, "write">;

// Tools сервера markdown-health, которые читают данные пользователя: этап «Чтение профиля».
const PROFILE_TOOLS = new Set([
  "mcp_markdown_health__read_profile",
  "mcp_markdown_health__read_recent_logs",
  "mcp_markdown_health__list_recipes",
]);
const KNOWLEDGE_TOOL = "searchKnowledge";

const stageId = (kind: StageKind, round: number) => (kind === "final" ? "final" : `r${round}-${kind}`);

function toolStage(step: CoachStep, name: string): { kind: StageKind; round: number } {
  if (step === "save") return { kind: "final", round: 0 };
  if (step > 1) return { kind: "revising", round: step };
  if (PROFILE_TOOLS.has(name)) return { kind: "profile", round: 1 };
  if (name === KNOWLEDGE_TOOL) return { kind: "knowledge", round: 1 };
  return { kind: "writing", round: 1 };
}

// Запрос к базе знаний из аргументов вызова; битый JSON — строка без запроса, а не ошибка.
function knowledgeQuery(name: string, args: string): string | undefined {
  if (name !== KNOWLEDGE_TOOL) return undefined;
  try {
    const { query } = JSON.parse(args) as { query?: unknown };
    return typeof query === "string" ? query : undefined;
  } catch {
    return undefined;
  }
}

export function createTimeline(writer: ChatWriter) {
  const stages = new Map<string, StageData>();
  const tools = new Map<string, ToolData>();

  const writeStage = (id: string, data: StageData) => {
    stages.set(id, data);
    writer.write({ type: "data-stage", id, data });
  };
  const writeTool = (id: string, data: ToolData) => {
    tools.set(id, data);
    writer.write({ type: "data-tool", id, data });
  };
  const setStageStatus = (id: string, status: StageData["status"]) => {
    const stage = stages.get(id);
    if (stage && stage.status !== status) writeStage(id, { ...stage, status });
  };
  // Этап создаётся при первом событии; уже закрытый (коуч снова прочитал профиль) открывается заново.
  const openStage = (kind: StageKind, round: number) => {
    const id = stageId(kind, round);
    const stage = stages.get(id);
    if (stage?.status !== "active") writeStage(id, { ...stage, kind, round, status: "active" });
    return id;
  };
  const closeIfIdle = (id: string) => {
    const busy = [...tools.values()].some((tool) => tool.stageId === id && tool.status === "active");
    if (!busy) setStageStatus(id, "done");
  };

  function handle(event: HealthAgentEvent) {
    switch (event.type) {
      case "coach_start":
        openStage(event.round === 1 ? "writing" : "revising", event.round);
        break;
      case "tool_start": {
        const { kind, round } = toolStage(event.step, event.name);
        const id = openStage(kind, round);
        const query = knowledgeQuery(event.name, event.args);
        writeTool(`${id}-${event.callId}`, { stageId: id, name: event.name, ...(query === undefined ? {} : { query }), status: "active" });
        break;
      }
      case "tool_end": {
        const { kind, round } = toolStage(event.step, event.name);
        const id = stageId(kind, round);
        const toolId = `${id}-${event.callId}`;
        const tool = tools.get(toolId);
        if (tool) writeTool(toolId, { ...tool, status: "done" });
        // Генерация, доработка и итог закрываются своими событиями, профиль и поиск — когда их tools закончились.
        if (kind === "profile" || kind === "knowledge") closeIfIdle(id);
        break;
      }
      case "coach_end":
        for (const [id, stage] of stages) {
          if (stage.round === event.round && stage.kind !== "review") setStageStatus(id, "done");
        }
        break;
      case "review_start":
        openStage("review", event.round);
        break;
      case "review_end":
        // Pre-check приходит без review_start: этап создаётся сразу завершённым.
        writeStage(stageId("review", event.round), {
          kind: "review",
          round: event.round,
          status: "done",
          review: event.review,
          precheck: event.precheck,
        });
        break;
      case "save_start":
        openStage("final", 0);
        break;
      case "save_end":
        setStageStatus("final", "done");
        break;
    }
  }

  // Запуск упал: всё, что ещё выполнялось, помечается ошибкой.
  function fail() {
    for (const [id, tool] of tools) if (tool.status === "active") writeTool(id, { ...tool, status: "error" });
    for (const [id, stage] of stages) if (stage.status === "active") writeStage(id, { ...stage, status: "error" });
  }

  return { handle, fail };
}
```

- [ ] **Step 5: Проверка таймлайна на синтетических событиях (без LLM)**

Создать временный `scripts/_check-timeline.ts` (не коммитить). Сценарий: раунд 1 с параллельными `searchKnowledge` ×2 и `read_profile` вперемешку, битые args, revise → раунд 2 → approve → сохранение; второй таймлайн — падение посреди раунда.

```ts
import { createTimeline } from "../src/chat/timeline";
import type { HealthAgentEvent } from "../src/harness/events";

function run(events: HealthAgentEvent[], failAtEnd = false) {
  const writes: { type: string; id: string; data: any }[] = [];
  const timeline = createTimeline({ write: (part) => writes.push(part as any) });
  events.forEach(timeline.handle);
  if (failAtEnd) timeline.fail();
  // Состояние, которое увидит клиент после reconciliation по id (в порядке первых записей).
  const state = new Map<string, any>();
  for (const { id, data } of writes) state.set(id, data);
  console.table([...state].map(([id, d]) => ({ id, what: d.kind ?? d.name, status: d.status, extra: d.query ?? d.review?.verdict ?? "" })));
}

const review = (verdict: "approve" | "revise", score: number) => ({ verdict, score, issues: verdict === "revise" ? ["Добавь разминку"] : [] });

run([
  { type: "coach_start", round: 1 },
  { type: "tool_start", step: 1, callId: "a", name: "searchKnowledge", args: '{"query":"ужин без молочки"}' },
  { type: "tool_start", step: 1, callId: "b", name: "searchKnowledge", args: "не json" },
  { type: "tool_start", step: 1, callId: "c", name: "mcp_markdown_health__read_profile", args: "{}" },
  { type: "tool_end", step: 1, callId: "a", name: "searchKnowledge" },
  { type: "tool_end", step: 1, callId: "c", name: "mcp_markdown_health__read_profile" },
  { type: "tool_end", step: 1, callId: "b", name: "searchKnowledge" },
  { type: "tool_start", step: 1, callId: "d", name: "suggestWorkoutTemplate", args: '{"goal":"сила"}' },
  { type: "tool_end", step: 1, callId: "d", name: "suggestWorkoutTemplate" },
  { type: "coach_end", round: 1 },
  { type: "review_start", round: 1 },
  { type: "review_end", round: 1, review: review("revise", 5), precheck: false },
  { type: "coach_start", round: 2 },
  { type: "tool_start", step: 2, callId: "a", name: "searchKnowledge", args: '{"query":"разминка"}' },
  { type: "tool_end", step: 2, callId: "a", name: "searchKnowledge" },
  { type: "coach_end", round: 2 },
  { type: "review_start", round: 2 },
  { type: "review_end", round: 2, review: review("approve", 9), precheck: false },
  { type: "save_start" },
  { type: "tool_start", step: "save", callId: "s", name: "mcp_markdown_health__save_health_plan", args: "{}" },
  { type: "tool_end", step: "save", callId: "s", name: "mcp_markdown_health__save_health_plan" },
  { type: "save_end" },
]);

run([
  { type: "coach_start", round: 1 },
  { type: "tool_start", step: 1, callId: "a", name: "searchKnowledge", args: '{"query":"сон"}' },
], true);
```

Run: `npx tsx scripts/_check-timeline.ts`
Expected — первая таблица (порядок строк = порядок первых записей), все `status` = `done`:

| id | what | extra |
|---|---|---|
| r1-writing | writing | |
| r1-knowledge | knowledge | |
| r1-knowledge-a | searchKnowledge | ужин без молочки |
| r1-knowledge-b | searchKnowledge | *(пусто — битый JSON)* |
| r1-profile | profile | |
| r1-profile-c | mcp_markdown_health__read_profile | |
| r1-writing-d | suggestWorkoutTemplate | |
| r1-review | review | revise |
| r2-revising | revising | |
| r2-revising-a | searchKnowledge | разминка |
| r2-review | review | approve |
| final | final | |
| final-s | mcp_markdown_health__save_health_plan | |

Важно: `r1-knowledge` должен остаться `done` только после завершения `b` (последнего из двух параллельных поисков) — проверь по порядку записей, добавив временно `console.log(writes.filter(w => w.id === "r1-knowledge"))`, если сомневаешься: записи `active` → `done` ровно по одной.

Вторая таблица: `r1-writing` — `error`, `r1-knowledge` — `error`, `r1-knowledge-a` — `error`.

Затем: `rm scripts/_check-timeline.ts`

- [ ] **Step 6: Проверка типов**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/chat/messages.ts src/chat/timeline.ts
git commit -m "Чат: AI SDK, типы сообщений и таймлайн из событий harness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Стриминговый route `/api/chat`

**Files:**
- Create: `app/api/agent/test-options.ts`
- Modify: `app/api/agent/run/route.ts` (целиком, см. ниже)
- Create: `src/chat/streamPlan.ts`
- Create: `app/api/chat/route.ts`

**Interfaces:**
- Consumes: `createTimeline`, `ChatWriter` (Task 2), `HealthChatMessage`, `ResultData` (Task 2), `runHealthAgent`, `RunOptions` (+ `onEvent`, Task 1).
- Produces:
  - `parseTestOptions(body: Record<string, unknown>): RunOptions | string` в `app/api/agent/test-options.ts`
  - `planDeltas(plan: string): string[]`, `streamPlan(writer: ChatWriter, plan: string, signal: AbortSignal): Promise<void>` в `src/chat/streamPlan.ts`; id текстовой части — `"plan"`
  - `POST /api/chat`: тело `{ task: string; minRounds?: number; prompts?: { coach?: string; reviewer?: string } }` → поток UI-сообщения (`data-stage`, `data-tool`, `text-*` с id `plan`, `data-result` с id `result`); 400 JSON `{ error }` при пустом `task` или неверных тестовых параметрах.

- [ ] **Step 1: Вынести `parseTestOptions` в `app/api/agent/test-options.ts`**

```ts
import { ACTIVE_PROMPTS } from "@/src/harness/promptVersions";
import type { RunOptions } from "@/src/harness/runHealthAgent";

// Тестовые параметры (minRounds, версии промптов) принимаются только вне production.
// Общие для /api/agent/run и /api/chat.
export function parseTestOptions(body: Record<string, unknown>): RunOptions | string {
  const { minRounds, prompts } = body;
  if (minRounds === undefined && prompts === undefined) return {};
  if (process.env.NODE_ENV === "production") return "Тестовые параметры доступны только в dev-режиме.";

  const options: RunOptions = {};
  if (minRounds !== undefined) {
    if (typeof minRounds !== "number") return "minRounds должен быть числом.";
    options.minRounds = minRounds;
  }
  if (prompts !== undefined) {
    const { coach, reviewer } = (prompts ?? {}) as Record<string, unknown>;
    if ((coach !== undefined && typeof coach !== "string") || (reviewer !== undefined && typeof reviewer !== "string")) {
      return "prompts.coach и prompts.reviewer должны быть строками.";
    }
    options.promptVersions = { coach: coach ?? ACTIVE_PROMPTS.coach, reviewer: reviewer ?? ACTIVE_PROMPTS.reviewer };
  }
  return options;
}
```

- [ ] **Step 2: `app/api/agent/run/route.ts` — импорт вместо локальной функции**

Файл целиком (обработчик `POST` не меняется ни в одном символе):

```ts
import { runHealthAgent } from "@/src/harness/runHealthAgent";
import { parseTestOptions } from "../test-options";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const task = typeof body?.task === "string" ? body.task.trim() : "";
  if (!task) return Response.json({ error: "Поле task обязательно." }, { status: 400 });
  const options = parseTestOptions(body);
  if (typeof options === "string") return Response.json({ error: options }, { status: 400 });

  try {
    return Response.json(await runHealthAgent(task, options));
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    return Response.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Создать `src/chat/streamPlan.ts`**

```ts
import type { ChatWriter } from "./timeline";

// План приходит из harness целиком — уже после ревью, поэтому непроверенный текст в чат не попадает.
// В чат он выдаётся небольшими дельтами, как поток токенов.
const WORDS_PER_DELTA = 3;
const DELTA_DELAY_MS = 15;
const PLAN_TEXT_ID = "plan";

// Кусочки по несколько слов вместе с пробелами и переводами строк после них: склейка дельт равна плану.
export function planDeltas(plan: string): string[] {
  const leading = /^\s*/.exec(plan)?.[0] ?? "";
  const words = plan.slice(leading.length).match(/\S+\s*/g) ?? [];
  const deltas: string[] = [];
  for (let index = 0; index < words.length; index += WORDS_PER_DELTA) {
    deltas.push(words.slice(index, index + WORDS_PER_DELTA).join(""));
  }
  if (leading) deltas.unshift(leading);
  return deltas;
}

// Если клиент ушёл, проигрывание прекращается: писать больше некому.
export async function streamPlan(writer: ChatWriter, plan: string, signal: AbortSignal) {
  writer.write({ type: "text-start", id: PLAN_TEXT_ID });
  for (const delta of planDeltas(plan)) {
    if (signal.aborted) return;
    writer.write({ type: "text-delta", id: PLAN_TEXT_ID, delta });
    await new Promise((resolve) => setTimeout(resolve, DELTA_DELAY_MS));
  }
  writer.write({ type: "text-end", id: PLAN_TEXT_ID });
}
```

- [ ] **Step 4: Проверка `planDeltas` — склейка равна исходному тексту**

Создать временный `scripts/_check-deltas.ts` (не коммитить):

```ts
import { readFile } from "node:fs/promises";
import { planDeltas } from "../src/chat/streamPlan";

const samples = [
  "# План на завтра\n\n## Питание\n\n| Приём | Блюдо | Ккал |\n|---|---|---|\n| Завтрак | Овсянка 60 г | 350 |\n\n- пункт  с  двойными пробелами\n  - вложенный\n\n**Итого:** 1800 ккал\n",
  "  ведущие пробелы",
  "",
  // Последний сохранённый настоящий план (data/output.md генерируется агентом; если его нет — пустая строка).
  await readFile("data/output.md", "utf8").catch(() => ""),
];
for (const sample of samples) {
  const deltas = planDeltas(sample);
  console.log(deltas.join("") === sample ? "OK  " : "FAIL", deltas.length, JSON.stringify(sample.slice(0, 30)));
}
```

Run: `npx tsx scripts/_check-deltas.ts`
Expected: все строки начинаются с `OK`. (Если `data/output.md` нет — последняя строка `OK 0 ""`, это нормально.)

Затем: `rm scripts/_check-deltas.ts`

- [ ] **Step 5: Создать `app/api/chat/route.ts`**

```ts
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import type { HealthChatMessage, ResultData } from "@/src/chat/messages";
import { streamPlan } from "@/src/chat/streamPlan";
import { createTimeline } from "@/src/chat/timeline";
import { runHealthAgent, type HealthAgentResult } from "@/src/harness/runHealthAgent";
import { parseTestOptions } from "../agent/test-options";

// Чат: та же задача, что у /api/agent/run, но ответ — поток UI-сообщения AI SDK. Сначала этапы и tools
// по мере работы агента (data-stage / data-tool), затем план текстовыми дельтами и итог (data-result).
// Клиент присылает только текст последнего сообщения: каждый запуск агента независим, диалога у harness нет.

const toResult = (result: HealthAgentResult): ResultData => ({
  review: result.review,
  approved: result.review.verdict === "approve",
  rounds: result.rounds.length,
  finalScore: result.finalScore,
  improved: result.improved,
  promptVersions: result.promptVersions,
  model: result.model,
  durationMs: result.durationMs,
  actions: result.actions,
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const task = typeof body?.task === "string" ? body.task.trim() : "";
  if (!task) return Response.json({ error: "Поле task обязательно." }, { status: 400 });
  const options = parseTestOptions(body);
  if (typeof options === "string") return Response.json({ error: options }, { status: 400 });

  const stream = createUIMessageStream<HealthChatMessage>({
    execute: async ({ writer }) => {
      const timeline = createTimeline(writer);
      let result: HealthAgentResult;
      try {
        result = await runHealthAgent(task, { ...options, onEvent: timeline.handle });
      } catch (error) {
        timeline.fail();
        throw error;
      }
      // needs_human_professional — плана нет, UI покажет карточку специалиста из data-result.
      if (result.plan) await streamPlan(writer, result.plan, request.signal);
      if (request.signal.aborted) return;
      writer.write({ type: "data-result", id: "result", data: toResult(result) });
    },
    onError: (error) => {
      console.error(error);
      return error instanceof Error ? error.message : "Неизвестная ошибка";
    },
  });
  return createUIMessageStreamResponse({ stream });
}
```

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 6: Проверка route через curl (без LLM)**

Запусти dev-сервер в фоне из корня репо: `npm run dev` (или preview `dev` из `.claude/launch.json`), дождись `Ready`.

Тела запросов — через heredoc, чтобы кириллица ушла в UTF-8:

```bash
curl -s -w '\n%{http_code}\n' -X POST localhost:3000/api/chat -H 'Content-Type: application/json' --data-binary @- <<'EOF'
{"task":"   "}
EOF
```
Expected: `{"error":"Поле task обязательно."}` и `400`.

```bash
curl -sN -X POST localhost:3000/api/chat -H 'Content-Type: application/json' --data-binary @- <<'EOF'
{"task":"Какие таблетки пить от давления?"}
EOF
```
Expected (SSE, порядок): строка с `"type":"data-stage","id":"r1-review"` и `"verdict":"needs_human_professional"`, `"precheck":true`; строка `"type":"data-result","id":"result"` с `"approved":false`; **ни одной** `text-delta`; в конце `data: [DONE]`.

```bash
curl -sN -X POST localhost:3000/api/chat -H 'Content-Type: application/json' --data-binary @- <<'EOF'
{"task":"План питания на завтра","prompts":{"coach":"nope"}}
EOF
```
Expected: чанк `{"type":"error","errorText":"Промпт prompts/healthCoach.nope.md не найден."}` (ошибка до спавна MCP, таймлайна нет); в консоли dev-сервера — этот же текст из `console.error`.

```bash
curl -s -X POST localhost:3000/api/agent/run -H 'Content-Type: application/json' --data-binary @- <<'EOF'
{"task":"Какие таблетки пить от давления?"}
EOF
```
Expected: JSON прежней формы — ключи `plan` (`""`), `review`, `rounds`, `finalScore`, `improved`, `promptVersions`, `model`, `toolCalls`, `retrievals`, `actions`, `durationMs`.

- [ ] **Step 7: Проверка на реальном запуске с ревизией и обрыве клиента (DeepSeek, нужен `.env`)**

Полный цикл revise → approve (тестовые промпты):

```bash
curl -sN -X POST localhost:3000/api/chat -H 'Content-Type: application/json' --data-binary @- <<'EOF' | grep -o '"type":"[a-z-]*","id":"[^"]*"\|"status":"[a-z]*"\|"verdict":"[a-z_]*"' | uniq
{"task":"План тренировок на завтра без зала","prompts":{"coach":"test-revise","reviewer":"test-revise"}}
EOF
```
Expected: сначала `data-stage` `r1-writing` active, затем `data-tool`/`data-stage` раунда 1 (`r1-profile`, `r1-knowledge`, … — какие вызвал коуч), `r1-review` с `revise`, `r2-revising`, `r2-review` с `approve`, `final` (active → done) с `final-<callId>` для `save_health_plan`, затем много `text-delta` c id `plan`, `text-end`, `data-result`. Все этапы в итоге `done`.

Обрыв клиента посреди запуска:

```bash
curl -sN --max-time 8 -X POST localhost:3000/api/chat -H 'Content-Type: application/json' --data-binary @- <<'EOF' > /dev/null
{"task":"План питания на завтра с учётом моего лога"}
EOF
```
Expected: curl завершается по таймауту (код 28). В консоли dev-сервера через 1–2 минуты — обычные строки harness до конца («Раунд …», «План одобрен и сохранен…» или «…не прошел ревью…»), **нет** `Unhandled`/`uncaughtException`; допустимы строки `onEvent(...)` из `safeEmit`. Новый файл в `runs/` появился (`ls -t runs | head -1`).

- [ ] **Step 8: Commit**

```bash
git add app/api/agent/test-options.ts app/api/agent/run/route.ts src/chat/streamPlan.ts app/api/chat/route.ts
git commit -m "Чат: стриминговый route /api/chat — этапы, tools, план дельтами, итог

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Компоненты чата

**Files:**
- Modify: `components/agent-result.tsx`
- Create: `components/chat/timeline.tsx`
- Create: `components/chat/message.tsx`

**Interfaces:**
- Consumes: `HealthChatMessage`, `StageData`, `StageKind`, `Status`, `ToolData`, `ResultData` (типы, Task 2); `VERDICTS`, `MAX_ROUNDS`, `formatDuration` (уже экспортируются из `components/agent-result.tsx`); `Markdown` из `components/markdown.tsx` (`{ source, hideTitle?, className? }`).
- Produces:
  - из `components/agent-result.tsx`: `export function describeTool(name: string, query?: string): { icon; label: string; kind: "rag" | "mcp" | "local"; source: string; tool: string }`, `export function ToolCallRow`, `export function PlanActionButton`, `export function CopyButton`
  - `components/chat/timeline.tsx`: `buildTimeline(parts: HealthChatMessage["parts"]): TimelineStage[]`, `Timeline({ parts, running })`
  - `components/chat/message.tsx`: `ChatMessage({ message, running }: { message: HealthChatMessage; running: boolean })`

- [ ] **Step 1: Экспорты и `describeTool` в `components/agent-result.tsx`**

Добавить `export` перед объявлениями (логику не менять):
- `function ToolCallRow(` → `export function ToolCallRow(`
- `function PlanActionButton(` → `export function PlanActionButton(`
- `function CopyButton(` → `export function CopyButton(`

Добавить сразу после функции `toolKind` (перед `export const VERDICTS`):

```tsx
// Строка вызова для ToolCallRow по имени tool: подпись и иконка из TOOLS, цвет и бейдж — по источнику.
// query — подпись поиска по базе знаний (таймлайн чата); без него — обычная подпись tool-а.
export function describeTool(name: string, query?: string) {
  const { source, tool } = parseTool(name);
  const kind = toolKind(source, tool);
  const { label, icon } = query !== undefined ? { label: `«${query}»`, icon: BookOpenIcon } : TOOLS[tool] ?? { label: tool, icon: WrenchIcon };
  return { icon, label, kind, source: kind === "rag" ? "rag" : source, tool };
}
```

`ToolCallList`, `Result` и остальное не трогать.

- [ ] **Step 2: Создать `components/chat/timeline.tsx`**

```tsx
"use client";

import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import type { HealthChatMessage, StageData, StageKind, Status, ToolData } from "@/src/chat/messages";
import { describeTool, ToolCallRow, VERDICTS } from "@/components/agent-result";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// Таймлайн ответа: этапы из частей data-stage, вызовы tools из data-tool, вложенные в свой этап.

// Порядок этапов внутри раунда — как в задаче: данные, поиск, генерация (или доработка), проверка.
const KIND_ORDER: Record<StageKind, number> = { profile: 0, knowledge: 1, writing: 2, revising: 2, review: 3, final: 4 };

type TimelineTool = ToolData & { id: string; number: number };
export type TimelineStage = StageData & { id: string; tools: TimelineTool[] };

// Номер tool — порядок вызова за весь запуск (части data-tool идут в порядке первых записей):
// этапы сгруппированы по смыслу, а по номерам видно, в каком порядке коуч работал на самом деле.
export function buildTimeline(parts: HealthChatMessage["parts"]): TimelineStage[] {
  const stages = new Map<string, TimelineStage>();
  const tools: TimelineTool[] = [];
  for (const part of parts) {
    if (part.type === "data-stage" && part.id) stages.set(part.id, { ...part.data, id: part.id, tools: [] });
    if (part.type === "data-tool" && part.id) tools.push({ ...part.data, id: part.id, number: tools.length + 1 });
  }
  for (const tool of tools) stages.get(tool.stageId)?.tools.push(tool);
  const position = (stage: TimelineStage) => (stage.kind === "final" ? Number.MAX_SAFE_INTEGER : stage.round * 10 + KIND_ORDER[stage.kind]);
  return [...stages.values()].sort((a, b) => position(a) - position(b));
}

function stageLabel({ kind, round, precheck }: StageData): string {
  switch (kind) {
    case "profile":
      return "Чтение профиля";
    case "knowledge":
      return "Поиск в базе знаний";
    case "writing":
      return "Генерация плана";
    case "revising":
      return `Доработка · раунд ${round}`;
    case "review":
      if (precheck) return "Проверка безопасности · pre-check";
      return round > 1 ? `Проверка безопасности · раунд ${round}` : "Проверка безопасности";
    case "final":
      return "Итоговый план";
  }
}

const STEP_WORDS: Record<string, string> = { one: "шаг", few: "шага", many: "шагов", other: "шага" };
const stepsLabel = (count: number) => `${count} ${STEP_WORDS[new Intl.PluralRules("ru-RU").select(count)]}`;

export function Timeline({ parts, running }: { parts: HealthChatMessage["parts"]; running: boolean }) {
  const stages = buildTimeline(parts);
  if (!stages.length) {
    return running ? (
      <p className="flex items-center gap-2 text-muted-foreground">
        <Spinner aria-label="Загрузка" />
        Запускаю агента…
      </p>
    ) : null;
  }

  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className="group -mx-2.5 text-muted-foreground" />}
      >
        Ход работы · {stepsLabel(stages.length)}
        <ChevronDownIcon className="transition-transform group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 space-y-3">
          {stages.map((stage) => (
            <StageRow key={stage.id} stage={stage} />
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

function StageRow({ stage }: { stage: TimelineStage }) {
  const { review } = stage;
  const verdict = review ? VERDICTS[review.verdict] : null;
  // При needs_human_professional замечания показывает карточка специалиста под таймлайном.
  const issues = review && review.verdict !== "needs_human_professional" ? review.issues : [];

  return (
    <li>
      <div className="flex items-center gap-2.5">
        <StatusIcon status={stage.status} />
        <span className={cn("font-medium", stage.status === "error" && "text-destructive")}>{stageLabel(stage)}</span>
        {review && verdict && (
          <span className="ml-auto flex items-center gap-2.5">
            <Badge className={cn("h-5 px-2", verdict.className)}>
              <verdict.icon data-icon="inline-start" />
              {verdict.label}
            </Badge>
            <span className="font-medium tabular-nums">
              {review.score}
              <span className="font-normal text-muted-foreground"> / 10</span>
            </span>
          </span>
        )}
      </div>
      {issues.length > 0 && (
        <ul className="mt-1.5 space-y-1 pl-6.5 text-muted-foreground">
          {issues.map((issue, index) => (
            <li key={index} className="flex gap-2.5">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />
              {issue}
            </li>
          ))}
        </ul>
      )}
      {stage.tools.length > 0 && (
        <ol className="mt-1 space-y-0.5 pl-6.5">
          {stage.tools.map((tool) => (
            <li
              key={tool.id}
              className={cn("py-0.5", tool.status === "active" && "animate-pulse", tool.status === "error" && "text-destructive")}
            >
              <ToolCallRow number={tool.number} {...describeTool(tool.name, tool.query)} />
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function StatusIcon({ status }: { status: Status }) {
  if (status === "active") return <Spinner aria-label="Выполняется" className="text-muted-foreground" />;
  if (status === "error") return <XIcon aria-label="Ошибка" className="size-4 shrink-0 text-destructive" />;
  return <CheckIcon aria-label="Готово" className="size-4 shrink-0 text-success" />;
}
```

- [ ] **Step 3: Создать `components/chat/message.tsx`**

```tsx
"use client";

import { ClockIcon, FileTextIcon, OctagonAlertIcon, TriangleAlertIcon } from "lucide-react";
import type { HealthChatMessage, ResultData } from "@/src/chat/messages";
import { CopyButton, formatDuration, MAX_ROUNDS, PlanActionButton, VERDICTS } from "@/components/agent-result";
import { Timeline } from "@/components/chat/timeline";
import { Markdown } from "@/components/markdown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const messageText = (message: HealthChatMessage) =>
  message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");

// Итог запуска (data-result) — последняя часть ответа; до конца запуска её нет.
function resultOf(message: HealthChatMessage) {
  for (const part of message.parts) if (part.type === "data-result") return part.data;
  return undefined;
}

// running — это последнее сообщение, и запуск ещё идёт.
export function ChatMessage({ message, running }: { message: HealthChatMessage; running: boolean }) {
  if (message.role === "user") {
    return (
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 whitespace-pre-wrap">
        {messageText(message)}
      </div>
    );
  }

  const plan = messageText(message);
  const result = resultOf(message);

  return (
    <div className="space-y-5">
      <Timeline parts={message.parts} running={running} />
      {result?.review.verdict === "needs_human_professional" && <SpecialistCard issues={result.review.issues} />}
      {plan && <Markdown source={plan} className="[--typeset-size:0.9375rem]" />}
      {result && <ResultFooter result={result} plan={plan} />}
    </div>
  );
}

function SpecialistCard({ issues }: { issues: string[] }) {
  return (
    <Alert variant="destructive">
      <OctagonAlertIcon />
      <AlertTitle>Требуется специалист</AlertTitle>
      <AlertDescription>
        <p>Вопросы о лекарствах, симптомах и лечении лучше обсудить с врачом — коуч не даёт по ним рекомендаций.</p>
        {issues.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}

function ResultFooter({ result, plan }: { result: ResultData; plan: string }) {
  const { review, approved, rounds, durationMs, promptVersions, actions } = result;
  const verdict = VERDICTS[review.verdict];

  return (
    <div className="space-y-3">
      {review.verdict === "revise" && plan && (
        <Alert>
          <TriangleAlertIcon className="text-warning" />
          <AlertTitle>План не прошёл ревью</AlertTitle>
          <AlertDescription>За {rounds} раунда ревьюер не одобрил план, поэтому он не сохранён в output.md.</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
        <Badge className={cn("h-6 px-2.5", verdict.className)}>
          <verdict.icon data-icon="inline-start" />
          {verdict.label}
        </Badge>
        <span>
          Оценка <span className="font-medium text-foreground tabular-nums">{review.score}</span> / 10
        </span>
        <span>
          Раунды <span className="font-medium text-foreground tabular-nums">{rounds}</span> / {MAX_ROUNDS}
        </span>
        <span className="flex items-center gap-1.5">
          <ClockIcon className="size-3.5" />
          <span className="tabular-nums">{formatDuration(durationMs)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <FileTextIcon className="size-3.5" />
          <span>
            coach <span className="font-mono">{promptVersions.coach}</span>, reviewer{" "}
            <span className="font-mono">{promptVersions.reviewer}</span>
          </span>
        </span>
        {plan && (
          <span className="ml-auto">
            <CopyButton text={plan} />
          </span>
        )}
      </div>
      {approved && actions.length > 0 && (
        <div className="space-y-3">
          {actions.map((action) => (
            <PlanActionButton key={action.server} action={action} plan={plan} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Проверка типов**

Run: `npx tsc --noEmit`
Expected: без ошибок. Если TS не сужает `part.data` по `part.type === "data-stage"` — сверь тип `DataUIPart` в `node_modules/ai/dist/index.d.ts` и используй его форму (`{ type: \`data-${name}\`; id?: string; data }`).

- [ ] **Step 5: Commit**

```bash
git add components/agent-result.tsx components/chat/timeline.tsx components/chat/message.tsx
git commit -m "Чат: компоненты таймлайна и сообщения

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Страница чата

**Files:**
- Rewrite: `app/page.tsx`

**Interfaces:**
- Consumes: `ChatMessage` (Task 4), `HealthChatMessage` (тип, Task 2), `POST /api/chat` (Task 3), `useChat` из `@ai-sdk/react`, `DefaultChatTransport` из `ai`.
- Produces: главная страница — чат.

- [ ] **Step 1: Переписать `app/page.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUpIcon, CircleAlertIcon, FlaskConicalIcon, LeafIcon, TerminalIcon } from "lucide-react";
import type { HealthChatMessage } from "@/src/chat/messages";
import { MAX_ROUNDS } from "@/components/agent-result";
import { ChatMessage } from "@/components/chat/message";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// Тестовый режим из URL (только dev): ?coach=test-revise&reviewer=test-revise&minRounds=2
type TestOptions = { minRounds?: number; prompts?: { coach?: string; reviewer?: string } };

function readTestOptions(search: string): TestOptions | null {
  const params = new URLSearchParams(search);
  const coach = params.get("coach") ?? undefined;
  const reviewer = params.get("reviewer") ?? undefined;
  const minRounds = params.has("minRounds") ? Number(params.get("minRounds")) : undefined;
  if (!coach && !reviewer && minRounds === undefined) return null;
  return { minRounds, prompts: coach || reviewer ? { coach, reviewer } : undefined };
}

const SUGGESTIONS = [
  "План питания на завтра с учётом моего лога",
  "Составь список покупок к плану",
  "План на неделю с учётом boulder-тренировок",
  "Как выровнять сон за 7 дней",
];

// Агенту уходит только текст последнего сообщения: каждый запуск независим, историю видит только UI.
const transport = new DefaultChatTransport<HealthChatMessage>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ messages, body }) => {
    const task = (messages.at(-1)?.parts ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");
    return { body: { ...body, task } };
  },
});

// Ошибка 400/500 от route приходит текстом тела ответа: {"error": "..."} — показываем только сообщение.
function errorText(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : error.message;
  } catch {
    return error.message;
  }
}

// Прокрутка «прилипает» к низу, пока пользователь сам не отлистал вверх дальше этого порога.
const NEAR_BOTTOM_PX = 120;

export default function Home() {
  const [input, setInput] = useState("");
  const [testOptions, setTestOptions] = useState<TestOptions | null>(null);
  useEffect(() => setTestOptions(readTestOptions(window.location.search)), []);
  const { messages, sendMessage, status, error } = useChat<HealthChatMessage>({ transport });
  const running = status === "submitted" || status === "streaming";
  const canSend = !running && Boolean(input.trim());

  // Состояние «у низа» обновляют только прокрутки: рост контента его не сбрасывает.
  const stickToBottom = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      const distance = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      stickToBottom.current = distance <= NEAR_BOTTOM_PX;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (stickToBottom.current) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [messages, status, error]);

  function send() {
    if (!canSend) return;
    stickToBottom.current = true;
    sendMessage({ text: input.trim() }, { body: testOptions ?? {} });
    setInput("");
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-2xl flex-col px-4">
      <header className="flex h-16 items-center justify-between">
        <div className="flex items-center gap-2.5 text-sm font-medium">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <LeafIcon className="size-4" />
          </span>
          Health Coach
        </div>
        <div className="flex items-center gap-1">
          {/* Replay и evals — только в dev, как и тестовый режим. */}
          {process.env.NODE_ENV !== "production" && (
            <Link href="/dev" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-muted-foreground")}>
              <TerminalIcon />
              Dev
            </Link>
          )}
          <ThemeToggle />
        </div>
      </header>

      {testOptions && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <FlaskConicalIcon className="size-3.5" />
            Тестовый режим
          </span>
          {testOptions.prompts?.coach && <span>coach <span className="font-mono">{testOptions.prompts.coach}</span></span>}
          {testOptions.prompts?.reviewer && <span>reviewer <span className="font-mono">{testOptions.prompts.reviewer}</span></span>}
          {testOptions.minRounds !== undefined && <span>minRounds <span className="font-mono">{testOptions.minRounds}</span></span>}
        </div>
      )}

      <main className="flex-1 pb-6">
        {messages.length === 0 ? (
          <section className="pt-12 sm:pt-20">
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Персональный план без лишней воды</h1>
            <p className="mt-3 max-w-xl text-pretty text-muted-foreground">
              Коуч составляет план по вашему профилю и дневнику, Safety Reviewer проверяет его на безопасность —
              до {MAX_ROUNDS} раундов правок. Каждый шаг виден по ходу работы.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  size="sm"
                  className="rounded-full font-normal text-muted-foreground"
                  onClick={() => setInput(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </section>
        ) : (
          <div className="space-y-8 pt-6">
            {messages.map((message, index) => (
              <ChatMessage key={message.id} message={message} running={running && index === messages.length - 1} />
            ))}
            {status === "submitted" && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Spinner aria-label="Загрузка" />
                Запускаю агента…
              </p>
            )}
            {error && (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Не удалось получить план</AlertTitle>
                <AlertDescription>{errorText(error)}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </main>

      <form
        className="sticky bottom-0 bg-background pt-2 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        {/* has-disabled:* у InputGroup срабатывает и на заблокированную кнопку — поле при этом гаснуть не должно. */}
        <InputGroup className="bg-background shadow-xs has-disabled:bg-background has-disabled:opacity-100 dark:bg-input/30 dark:has-disabled:bg-input/30">
          <InputGroupTextarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            disabled={running}
            placeholder={running ? "Агент работает…" : "Например: составь план питания на завтра"}
            aria-label="Задача для коуча"
            className="max-h-48 min-h-12 px-3.5 pt-3 text-base md:text-base"
          />
          <InputGroupAddon align="block-end" className="gap-3 px-3 pb-3">
            <span className="hidden items-center gap-1.5 text-xs font-normal sm:flex">
              <Kbd>Enter</Kbd> отправить, <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> перенос
            </span>
            <InputGroupButton type="submit" variant="default" size="sm" className="ml-auto" disabled={!canSend}>
              {running ? <Spinner aria-label="Загрузка" /> : <ArrowUpIcon />}
              {running ? "Работает…" : "Отправить"}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}
```

Run: `npx tsc --noEmit`
Expected: без ошибок. Если `DefaultChatTransport` в 7.x не принимает generic или `prepareSendMessagesRequest` должен вернуть другое поле — поправь по `.d.ts` из Task 2 Step 2 (смысл: тело POST = `{ ...body, task }`).

- [ ] **Step 2: Открыть страницу**

Запусти (или переиспользуй) dev-сервер: preview `dev` из `.claude/launch.json` (или `npm run dev`), открой `http://localhost:3000/`.
Expected: шапка, заголовок, чипы-подсказки, композер внизу; в консоли браузера нет ошибок (кроме штатных сообщений HMR).

- [ ] **Step 3: Pre-check — карточка специалиста (без LLM)**

Введи «Какие таблетки пить от давления?», нажми Enter.
Expected: пузырь пользователя справа; в ответе — «Ход работы · 1 шаг» со строкой «Проверка безопасности · pre-check», бейдж «Нужен специалист», `0 / 10`; ниже красная карточка «Требуется специалист» со списком из одного пункта; **плана нет**; внизу итог с бейджем verdict, «Раунды 1 / 3». Инпут снова активен.

- [ ] **Step 4: Ревизия — отдельный шаг (DeepSeek)**

Открой `http://localhost:3000/?coach=test-revise&reviewer=test-revise`, отправь «План тренировок на завтра без зала».
Expected по ходу работы:
- сразу «Запускаю агента…», затем появляется «Генерация плана» со спиннером; над ним по мере вызовов — «Чтение профиля» / «Поиск в базе знаний» с вложенными строками tools (номер, иконка, подпись, бейдж `[markdown-health]` синим / `[rag]` фиолетовым / `[local]`, имя tool);
- пока запуск идёт, textarea и кнопка disabled, кнопка «Работает…»;
- «Проверка безопасности» → бейдж «Нужна доработка», score, под ним замечание про «Ограничения безопасности»;
- отдельный шаг «Доработка · раунд 2» со своими tools, затем «Проверка безопасности · раунд 2» → «Одобрено»;
- «Итоговый план» с вложенным `save_health_plan`;
- затем план стримится текстом (видно, как растёт), страница сама прокручивается вниз;
- внизу — «Одобрено», оценка, «Раунды 2 / 3», длительность, версии промптов `test-revise`, кнопка копирования; кнопка Notion — если задан `NOTION_TOKEN`.

Проверь автоскролл: во время стрима прокрути вверх — страница больше не дёргается вниз; прокрути обратно к низу — снова прилипает.

Сделай скриншот таймлайна с шагом «Доработка · раунд 2» — это доказательство для отчёта.

- [ ] **Step 5: Ошибка агента (без LLM)**

Открой `http://localhost:3000/?coach=nope`, отправь любую задачу без медицинских слов.
Expected: красный Alert «Не удалось получить план» с текстом «Промпт prompts/healthCoach.nope.md не найден.»; инпут снова активен.

- [ ] **Step 6: Второе сообщение после первого и после ошибки**

На той же вкладке (после Step 5) открой `/` без параметров, отправь подряд два pre-check запроса: «Какие таблетки пить от давления?», дождись ответа, затем «Что делать, если болит спина?».
Expected: два независимых ответа, у каждого свой таймлайн «Проверка безопасности · pre-check» и карточка; первый ответ не изменился после второго. Перезагрузка страницы очищает историю (персиста нет).

- [ ] **Step 7: Тёмная тема**

Переключи тему (ThemeToggle).
Expected: таймлайн, бейджи, пузырь пользователя, композер читаемы; цвета `[rag]`/`[mcp]` из токенов темы.

- [ ] **Step 8: Commit**

```bash
git add app/page.tsx
git commit -m "Главная страница: чат со стримингом и живым таймлайном этапов

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Документация и итоговая проверка

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: всё из Tasks 1–5.
- Produces: актуальный CLAUDE.md.

- [ ] **Step 1: CLAUDE.md — раздел Commands**

Заменить:

```
There is no user-facing CLI by design (the old `index.ts` was removed): users run the agents via `POST /api/agent/run` with `{ task }` (UI or curl).
```

на:

```
There is no user-facing CLI by design (the old `index.ts` was removed): users run the agents from the chat UI (`POST /api/chat`, streamed) or via `POST /api/agent/run` with `{ task }` (curl, one JSON response).
```

- [ ] **Step 2: CLAUDE.md — Request flow**

Заменить начало раздела Architecture:

```
Request flow: `app/page.tsx` (client) → `app/api/agent/run/route.ts` → `runHealthAgent(task, { maxRounds = 3, minRounds = 1, promptVersions = ACTIVE_PROMPTS })` in `src/harness/runHealthAgent.ts`
```

на:

```
Request flow: `app/page.tsx` (client chat, `useChat`) → `app/api/chat/route.ts` (streamed, see "Chat streaming" below; curl uses `app/api/agent/run/route.ts`, evals call the harness directly) → `runHealthAgent(task, { maxRounds = 3, minRounds = 1, promptVersions = ACTIVE_PROMPTS, onEvent? })` in `src/harness/runHealthAgent.ts`
```

- [ ] **Step 3: CLAUDE.md — тестовый режим**

Заменить:

```
Test mode (dev only): the route accepts `minRounds` and `prompts: { coach?, reviewer? }` (400 in production); the UI reads them from the URL,
```

на:

```
Test mode (dev only): `/api/agent/run` and `/api/chat` accept `minRounds` and `prompts: { coach?, reviewer? }` (shared `parseTestOptions` in `app/api/agent/test-options.ts`; 400 in production); the chat UI reads them from the URL,
```

- [ ] **Step 4: CLAUDE.md — новый подраздел перед `### Tools: local (`src/skills/`) and MCP (`src/mcp/`)`**

Вставить:

```markdown
### Chat streaming (`src/chat/`, `app/api/chat`)

- `src/harness/events.ts` — `HealthAgentEvent` (`coach_start/end {round}`, `tool_start/end {step, callId, name, args}`, `review_start/end {round, review, precheck}`, `save_start/end`), `safeEmit` (a throwing subscriber is logged, never breaks the run) and `emitToolEvents` (Agents SDK `agent_tool_start/end` hooks on the coach *instance*, not the global runner; they fire in plain `run()`, and calls to missing tools produce none — same as `toolCalls`). `runHealthAgent` only inserts `emit(...)` calls; without `onEvent` nothing subscribes and behavior is unchanged (evals, `/api/agent/run`, replay). The harness's own fallback `save_health_plan` call is not an event.
- `app/api/chat/route.ts` — body `{ task, minRounds?, prompts? }`: the client sends only the last message's text, every message is an independent run (the harness has no dialogue). `createUIMessageStream` (AI SDK `ai@7`): events → `createTimeline` (`src/chat/timeline.ts`) → `data-stage` / `data-tool` parts with stable ids (`r<N>-profile|knowledge|writing|review|revising`, `final`; tool id `<stage id>-<callId>`) that `useChat` reconciles in place. Round 1 tools are grouped by meaning (markdown-health reads → profile, `searchKnowledge` → knowledge, the rest → writing); from round 2 all tools go to `revising`, save-step tools to `final`. After `runHealthAgent` returns, `streamPlan` (`src/chat/streamPlan.ts`) replays the already reviewed plan as `text-delta`s (~3 words / 15 ms; the deltas join back to the exact plan) and `data-result` comes last. Unreviewed text never reaches the client, so `needs_human_professional` shows a card instead of a plan. On an exception `timeline.fail()` marks active rows `error` and `onError` sends the Russian message. If the client disconnects, the run still finishes (plan saved, trace written).
- `src/chat/messages.ts` — `HealthChatMessage = UIMessage<never, { stage, tool, result }>` and the part types; client code imports only these types.
```

- [ ] **Step 5: CLAUDE.md — раздел UI**

Заменить начало пункта (три первых предложения; остаток пункта про `MAX_ROUNDS` и ссылку на `/dev` сохраняется):

```
- `app/page.tsx` is a single client component with an `idle | running | result` state machine. It imports only the `HealthAgentResult` *type* from the harness. The result cards (`Result`, round history, tool calls, `VERDICTS`, `MAX_ROUNDS`) live in `components/agent-result.tsx` and are shared with `/dev`.
```

на:

```
- `app/page.tsx` is a single client chat component on `useChat` (`@ai-sdk/react`, `DefaultChatTransport` → `/api/chat`). History lives only in `useChat` state (no persistence, one chat); Enter sends, Shift+Enter is a newline; the input is disabled while running; window scroll sticks to the bottom unless the user scrolled up. Messages render via `components/chat/message.tsx` (user bubble; assistant: timeline → plan `Markdown` → verdict/score footer with copy and action buttons, or the «Требуется специалист» card) and `components/chat/timeline.tsx` (`buildTimeline`: stages sorted by round and kind, `final` last; tools nested under their stage and numbered in real call order via `describeTool` + `ToolCallRow`). The `/dev` result cards (`Result`, round history, tool calls, `VERDICTS`, `MAX_ROUNDS`) live in `components/agent-result.tsx`, which also exports the pieces the chat reuses.
```

И в пункте про MAX_ROUNDS / result card заменить `The result card shows duration, prompt versions and a collapsed round history (`components/ui/collapsible.tsx`).` на `The /dev result card shows duration, prompt versions and a collapsed round history (`components/ui/collapsible.tsx`).`

- [ ] **Step 6: Проверка типов и production-сборки**

Останови dev-сервер (сборка и `next dev` делят `.next/`).

Run: `npx tsc --noEmit`
Expected: без ошибок.

Run: `npm run build`
Expected: сборка успешна, в списке маршрутов есть `/api/chat` и `/api/agent/run`; нет ошибок про импорт серверного кода в клиентский бандл.

- [ ] **Step 7: `npm run eval` работает как раньше (DeepSeek, несколько минут)**

Run: `npm run eval`
Expected: прогон всех `evals/cases/*.json`, таблица PASS/FAIL и строка `N/6 PASS`. Ни одна строка не падает с ошибкой из кода событий или чата (evals не передают `onEvent`). FAIL допустим только по качеству модели (другой verdict, score ниже порога, не вызван tool) — как и до изменений. Если причина FAIL — исключение или сообщение об ошибке кода, остановись и разберись (superpowers:systematic-debugging), не коммить.

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md: чат со стримингом, события harness, src/chat

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
