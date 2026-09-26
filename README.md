# Health Coach Agent

Health Coach Agent + Safety Reviewer Agent (до 3 раундов ревизии) на OpenAI Agents SDK и DeepSeek, обёрнутые в Next.js (App Router).

## Запуск

`.env` в корне:

```
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com   # опционально
DEEPSEEK_MODEL=deepseek-v4-flash             # опционально
```

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
app/api/agent/run/route.ts    POST { task } → { plan, review, rounds[], finalScore, improved, promptVersions, model, toolCalls, durationMs }
components/ui/*               компоненты shadcn/ui (добавляются через `npx shadcn@latest add <name>`)
prompts/*.<версия>.md         тексты промптов коуча и ревьюера (активные версии — ACTIVE_PROMPTS; *.test-revise.md — тестовые)
components/markdown.tsx       рендер Markdown-плана (без dangerouslySetInnerHTML)
components/providers.tsx      next-themes (светлая / тёмная / системная тема) + TooltipProvider
components/theme-toggle.tsx   переключатель темы
src/agents/healthCoach.ts     агент-коуч и его массив tools
src/agents/safetyReviewer.ts  агент-ревьюер (без tools и побочных эффектов) и pre-check задачи
src/skills/*.ts               tools коуча: getProfile, getRecentLog, listFavoriteRecipes, suggestWorkoutTemplate, generateShoppingList, savePlan
src/harness/runHealthAgent.ts runHealthAgent(task, { maxRounds = 3, minRounds = 1, promptVersions }): оркестратор harness
src/harness/validateReview.ts Zod-схема ревью, safe-parse, один ретрай на невалидный JSON
src/harness/rounds.ts         RoundState и история раундов
src/harness/score.ts          finalScore (последний approve) и improved
src/harness/promptVersions.ts ACTIVE_PROMPTS и загрузка prompts/<имя>.<версия>.md
src/harness/traceRun.ts       трейс каждого запуска → runs/run-<timestamp>.json
scripts/replay.ts             npm run replay <трейс>: повтор задачи и сравнение «было / стало»
scripts/eval.ts               npm run eval: кейсы из evals/cases/*.json, таблица PASS/FAIL
runs/run-example.json         пример трейса (остальные runs/* в .gitignore)
data/profile.md, data/log.md  профиль и дневник — коуч читает их через tools
data/recipes.md               любимые рецепты (listFavoriteRecipes)
data/output.md                последний одобренный план (savePlan)
data/shopping.md              последний список покупок (generateShoppingList)
```

UI собран на [shadcn/ui](https://ui.shadcn.com) (стиль `base-nova` на Base UI, Tailwind CSS v4, иконки lucide); настройки CLI — в `components.json`.

Промпты, pre-check и loop перенесены из V0 без изменений. Новая версия промпта — файл `prompts/healthCoach.v2.md` и правка `ACTIVE_PROMPTS` в `src/harness/promptVersions.ts`. Пути к `data/` считаются от `process.cwd()`, поэтому `npm run dev` запускается из корня репозитория.

## Тестовый режим (только dev)

В dev-режиме `POST /api/agent/run` принимает `minRounds` и `prompts: { coach?, reviewer? }`, а UI берёт их из URL. Сценарий revise → approve:

```
http://localhost:3000/?coach=test-revise&reviewer=test-revise
```

Тестовый коуч намеренно пропускает раздел «Ограничения безопасности» в первом черновике, тестовый ревьюер возвращает на это `revise`. `?minRounds=2` не даёт approve завершить цикл раньше второго раунда. В production эти параметры отклоняются с 400.

## Как дебажить агента

Цикл: **trace → replay → eval**. Всё локально, в JSON-файлах; скрипты запускаются через `tsx` без сборки и читают `.env` из корня.

1. **Trace.** Каждый завершённый запуск (из UI, replay или eval) пишет `runs/run-<timestamp>.json`: задача, версии промптов, модель, раунды (первые 500 символов плана + ревью), toolCalls, finalScore, verdict, durationMs. Формат — в `runs/run-example.json`. Запуск, упавший с ошибкой, трейса не оставляет; ошибка записи трейса только логируется и не роняет запуск.
2. **Replay.** Поправили промпт, `ACTIVE_PROMPTS` или `DEEPSEEK_MODEL` — повторите ту же задачу текущим harness:
   ```bash
   npm run replay runs/run-XXX.json
   ```
   Скрипт печатает таблицу «было / стало» по verdict, finalScore, раундам, toolCalls, promptVersions и модели; изменившиеся строки помечены `≠`. Новый прогон тоже сохраняется в `runs/`.
3. **Eval.** Перед тем как оставить правку, прогоните кейсы из `evals/cases/*.json` (последовательно, реальные вызовы DeepSeek):
   ```bash
   npm run eval
   ```
   Кейс — `{ name, task, expect: { verdict, minScore? } }`. `bad-medical-request` проверяет safety gate: он проходит, только если агент остановился с `needs_human_professional` и не вернул план. При любом FAIL код выхода 1; трейс упавшего кейса можно отдать в replay.

## Почему удалён `index.ts`

Старый CLI (`index.ts`) удалён: приложение работает только через веб-интерфейс, единственная точка входа для задач пользователя — `POST /api/agent/run`, так логика не дублируется и не расходится между CLI и вебом. `tsx` вернулся только для dev-скриптов `replay` и `eval`: они вызывают тот же `runHealthAgent`. Логи раундов пишутся в консоль сервера `next dev`.
