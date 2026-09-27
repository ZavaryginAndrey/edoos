# Чат со стримингом и живыми статусами этапов — дизайн

Дата: 2026-09-27. Статус: согласован в чате, ждёт ревью spec.

## Цель

Заменить форму «задача → результат» на главной странице чатом: пользователь пишет задачу, в ответе
по мере работы агента появляется и обновляется таймлайн этапов (с вызовами tools), затем стримится
план, внизу — verdict и score. При `needs_human_professional` вместо плана — карточка «Требуется
специалист».

## Что сказал пользователь

- Vercel AI SDK (`useChat`) + стриминговый route `app/api/chat/route.ts`; история сообщений только
  в состоянии страницы; финальный план стримится токен за токеном.
- Этапы до финального текста: Reading profile, Searching knowledge (с запросом), Generating plan,
  Reviewing safety (verdict + score по завершении), Revising (round N) — только при ревизии, Final
  approved plan. Harness эмитит события через `onEvent`, route пишет их в стрим data-частями, UI
  рендерит таймлайн.
- Каждый tool call — строка таймлайна с источником `[mcp]` / `[local]` / `[rag]`.
- `needs_human_professional` → карточка «Требуется специалист» с issues вместо плана.
- `runHealthAgent` получает опциональный `onEvent`; `/api/agent/run` и evals работают без изменений.
- Без новых UI-библиотек; автоскролл; инпут заблокирован во время выполнения.
- Запрещено: переписывать harness (только эмиссия событий), персист истории, несколько диалогов,
  тесты и TDD.

## Решения, принятые в обсуждении

1. **План стримится после ревью.** `runHealthAgent` остаётся обычной async-функцией; route после её
   завершения отдаёт готовый план небольшими `text-delta`. Непроверенный текст пользователь не видит,
   поэтому карточка специалиста честно заменяет план. Живые токены DeepSeek не используются.
2. **UI из того, что уже есть:** `components/ui` (shadcn на Base UI), Tailwind-утилиты и токены темы.
   Новых UI-пакетов (AI Elements, assistant-ui и т. п.) нет. Тёмная тема сохраняется.
3. **Таймлайн: этапы в фиксированном порядке, tools вложены в свой этап** (вариант A). Этап
   появляется при первом своём событии; внутри раунда 1 порядок всегда «профиль → поиск →
   генерация → проверка», даже если модель вызывала tools иначе.

## Допущения

- Каждое сообщение чата — независимый запуск `runHealthAgent(task)`. Прошлые сообщения агенту
  не передаются: у harness нет понятия диалога, а подмешивание истории в `task` изменило бы pre-check,
  коуча и ревьюера.
- Подписи этапов — по-русски (правило CLAUDE.md): «Чтение профиля», «Поиск в базе знаний»,
  «Генерация плана», «Проверка безопасности», «Доработка · раунд N», «Итоговый план».
- `/dev`, карточка `Result`, replay и трейсы не меняются. Кнопки действий (Notion) показываются под
  одобренным планом в чате. Тестовый режим из URL (`?coach=test-revise&reviewer=test-revise`,
  `minRounds`) работает и в чате — им проверяется шаг ревизии.

## Архитектура

```
app/page.tsx (useChat)
  └─ POST /api/chat { task, minRounds?, prompts? }
       └─ createUIMessageStream
            ├─ runHealthAgent(task, { onEvent: timeline.handle })   ← события → data-stage / data-tool
            ├─ streamPlan(writer, result.plan)                        ← text-start / text-delta… / text-end
            └─ writer.write(data-result)                              ← verdict, score, раунды, длительность
```

### 1. События harness — `src/harness/events.ts` (новый)

```ts
export type HealthAgentEvent =
  | { type: "coach_start"; round: number }
  | { type: "coach_end"; round: number }
  | { type: "tool_start"; step: number | "save"; callId: string; name: string; args: string }
  | { type: "tool_end"; step: number | "save"; callId: string; name: string }
  | { type: "review_start"; round: number }
  | { type: "review_end"; round: number; review: Review; precheck: boolean }
  | { type: "save_start" }
  | { type: "save_end" };
export type OnEvent = (event: HealthAgentEvent) => void;
```

- `safeEmit(onEvent?)` → функция `emit(event)`: без `onEvent` ничего не делает; ошибка подписчика
  логируется (`console.error`) и не пробрасывается — событие никогда не роняет запуск.
- `emitToolEvents(agent, emit, currentStep)` подписывается на `agent.on("agent_tool_start")` и
  `agent.on("agent_tool_end")` **экземпляра** коуча (не глобального runner — параллельные запросы
  не видят чужих событий). Хуки Agents SDK 0.18 срабатывают и в нестриминговом `run()`; `toolCall`
  содержит `callId`, `name` (модельное имя, `mcp_<сервер>__<tool>` или локальное) и `arguments`
  (JSON-строка; пустая только при невалидном вводе).

Правки `src/harness/runHealthAgent.ts` — только вставки эмиссии, поток управления, результат,
трейс и логи не меняются:

- `RunOptions.onEvent?: OnEvent`; `const emit = safeEmit(options.onEvent)`.
- Pre-check сработал → `emit({ type: "review_end", round: 1, review: taskReview, precheck: true })`
  перед `finish` (без `review_start`: LLM не вызывается).
- В `runRounds`: после `createHealthCoach` — `emitToolEvents(coach, emit, () => step)`, только если
  `onEvent` передан; `step` — переменная замыкания: номер раунда или `"save"`.
- Вокруг `askCoach` — `coach_start` / `coach_end`; вокруг `askReviewer` — `review_start` /
  `review_end` (`precheck: false`); вокруг `savePlanByCoach` — `save_start` / `save_end` и
  `step = "save"`.

Осознанные границы:
- Запасное сохранение самим harness (`dataServer.callTool("save_health_plan")`) события не даёт:
  это не вызов коуча, в `toolCalls` его тоже нет.
- Вызов отсутствующего tool (`return_error_to_model`) хуков не порождает — как и в `toolCalls`.
- Исключение из `runHealthAgent` отдельным событием не сообщается — его обрабатывает route.

### 2. Формат сообщений и route

**`src/chat/messages.ts`** (новый; клиент импортирует только типы):

```ts
type StageKind = "profile" | "knowledge" | "writing" | "review" | "revising" | "final";
type Status = "active" | "done" | "error";
export type StageData = { kind: StageKind; round: number; status: Status; review?: Review; precheck?: boolean };
export type ToolData = { stageId: string; name: string; query?: string; status: Status };
export type ResultData = {
  review: Review; approved: boolean; rounds: number; finalScore: number | null; improved: boolean;
  promptVersions: PromptVersions; model: string; durationMs: number; actions: PlanAction[];
};
export type HealthChatMessage = UIMessage<never, { stage: StageData; tool: ToolData; result: ResultData }>;
```

**`src/chat/timeline.ts`** (новый): `createTimeline(writer)` → `{ handle(event), fail() }`. Хранит
состояние этапов и tools текущего запуска, каждое изменение пишет `data-stage` / `data-tool` с
тем же `id` (AI SDK на клиенте обновляет часть по id).

Id этапов: `r<N>-profile`, `r<N>-knowledge`, `r<N>-writing`, `r<N>-review`, `r<N>-revising`,
`final`. Id tool: `<id этапа>-<callId>`.

| Событие | Запись |
|---|---|
| `coach_start {1}` | `r1-writing` active |
| `coach_start {N≥2}` | `rN-revising` active |
| `tool_start`, раунд 1 | `mcp_markdown_health__read_profile` / `read_recent_logs` / `list_recipes` → `r1-profile`; `searchKnowledge` → `r1-knowledge` (`query` из `args`); остальные → `r1-writing`. Этап создаётся active при первом вызове; tool — active |
| `tool_start`, раунд N≥2 | tool в `rN-revising` |
| `tool_start`, шаг `"save"` | tool в `final` |
| `tool_end` | tool done; `profile` / `knowledge` → done, когда в этапе нет активных tools |
| `coach_end {N}` | все незакрытые этапы раунда N → done |
| `review_start {N}` | `rN-review` active |
| `review_end {N}` | `rN-review` done, `review` + `precheck` |
| `save_start` / `save_end` | `final` active / done |

`fail()` переводит все active-этапы и tools в `error`.

**`app/api/agent/test-options.ts`** (новый): `parseTestOptions` переносится из
`app/api/agent/run/route.ts` без изменений; старый route его импортирует — поведение прежнее.

**`app/api/chat/route.ts`** (новый):

- Тело: `{ task, minRounds?, prompts? }` (клиент шлёт только текст последнего сообщения, не историю).
  Пустой `task` или неверные тестовые параметры → 400 JSON до открытия стрима.
- `createUIMessageStream<HealthChatMessage>({ execute, onError })`, `execute`:
  1. `const timeline = createTimeline(writer)`;
  2. `const result = await runHealthAgent(task, { ...options, onEvent: timeline.handle })`;
  3. если `result.plan` не пуст (одобренный или черновик после всех revise) — `streamPlan`:
     `text-start`, затем `text-delta` по ~3 слова (с сохранением пробелов и переводов строк) раз
     в ~15 мс, `text-end`; при `request.signal.aborted` проигрывание прекращается;
  4. `data-result` (id `result`) — последней частью (пропускается, если клиент уже ушёл).
- Исключение в `execute`: `timeline.fail()`, затем исключение пробрасывается; `onError` возвращает
  русский текст ошибки (`error.message` или «Неизвестная ошибка»), `console.error` — полное.
- `createUIMessageStreamResponse({ stream })`.
- Если клиент ушёл, harness дорабатывает до конца (план сохраняется, трейс пишется) — как в
  нестриминговом route; записи в закрытый стрим глушит `safeEmit`.

### 3. UI

Зависимости: `ai@^7`, `@ai-sdk/react@^4` (peer: React ^19.2.1, zod ^4.1.8 — совместимы).

**`app/page.tsx`** — чат, один клиентский компонент:

- Шапка без изменений (логотип, Dev в dev-режиме, ThemeToggle); плашка тестового режима из URL.
- Пустое состояние: заголовок и описание, чипы-подсказки (клик вставляет текст в поле).
- `useChat<HealthChatMessage>({ transport: new DefaultChatTransport({ api: "/api/chat",
  prepareSendMessagesRequest }) })`; `sendMessage({ text }, { body: testOptions })`, в
  `prepareSendMessagesRequest` тело — `{ ...body, task: <текст последнего сообщения> }`.
- История — только состояние `useChat`: без localStorage, один чат.
- Композер закреплён внизу: `InputGroup` + textarea + кнопка; Enter — отправить, Shift+Enter —
  перенос строки. При `status` `submitted` / `streaming` поле и кнопка disabled (фикс
  `has-disabled`, как сейчас).
- Автоскролл: якорь в конце списка; при изменении сообщений скролл к нему, если пользователь был у
  низа (≤ ~120 px); после своей отправки — всегда.
- `error` из `useChat` → `Alert` «Не удалось получить план» под последним сообщением.

**`components/chat/message.tsx`** (новый):

- Пользователь — пузырь справа (`bg-muted`).
- Ассистент — на всю ширину: таймлайн → план (текстовая часть через `Markdown` в `.typeset`,
  перерисовка на каждую дельту; кнопка копирования после окончания стрима) → итог из `data-result`:
  бейдж verdict (`VERDICTS`), оценка / 10, раунды / 3, длительность, версии промптов; при `approve` —
  `PlanActionButton` для `actions`; при последнем `revise` — пометка «Не прошёл ревью за N раундов,
  не сохранён».
- `needs_human_professional` — плана нет, `Alert` «Требуется специалист» со списком issues.

**`components/chat/timeline.tsx`** (новый):

- Этапы из `data-stage`, tools из `data-tool`, сгруппированные по `stageId`; сортировка по
  (раунд, порядок вида: profile, knowledge, writing, revising, review), `final` последним.
- Строка этапа: статус (`Spinner` / галочка / крестик) + подпись: «Чтение профиля», «Поиск в базе
  знаний», «Генерация плана», «Проверка безопасности» (+ «· раунд N» с раунда 2, «· pre-check» для
  pre-check), «Доработка · раунд N», «Итоговый план». У проверки — бейдж verdict и score, под ней
  issues.
- Вложенные строки tools: иконка, подпись, цветной бейдж `[mcp]` / `[local]` / `[rag]` и имя tool —
  через ту же логику, что `ToolCallList`; у `searchKnowledge` подпись — «запрос».
- Обёртка `Collapsible`, раскрыта по умолчанию, заголовок «Ход работы · N шагов».

**`components/agent-result.tsx`**: экспортировать `ToolCallRow`, `PlanActionButton`, `CopyButton` и
добавить `describeTool(name, query?)` — подпись, иконка и источник вызова на основе существующих
`TOOLS` / `parseTool` / `toolKind` (без изменения их логики). `Result` и `/dev` — как есть.
Карточка `Running` со старой страницы удаляется.

**CLAUDE.md**: обновить Architecture (chat route, события harness, `src/chat/`) и UI.

## Что не меняется

- `HealthAgentResult`, трейсы `runs/*.json`, replay, evals, `/dev`, `/api/agent/run`,
  `/api/agent/action`, промпты, pre-check, цикл раундов, MCP и RAG.
- Без `onEvent` harness ведёт себя байт-в-байт как раньше: хуки не подписываются.

## Проверка (без тестов — по требованию)

- `npx tsc --noEmit`.
- `npm run dev`, в браузере:
  - обычная задача → таймлайн оживает, план стримится, внизу verdict / score, кнопки действий;
  - `/?coach=test-revise&reviewer=test-revise` → шаг «Доработка · раунд 2» и повторная проверка;
  - медицинская задача → pre-check, карточка «Требуется специалист» с issues, плана нет;
  - автоскролл и disabled-инпут во время выполнения.
- `curl` к `POST /api/agent/run` — ответ прежней формы.
- `npm run eval` — работает как раньше (реальные вызовы DeepSeek).
