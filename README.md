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
app/api/agent/run/route.ts    POST { task } → { plan, review, rounds[], finalScore, improved, promptVersions, toolCalls, durationMs }
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

## Почему удалён `index.ts`

Старый CLI (`index.ts`) удалён вместе с зависимостью `tsx`: приложение работает только через веб-интерфейс. Единственная точка входа — `POST /api/agent/run`, так логика не дублируется и не расходится между CLI и вебом. Логи раундов по-прежнему пишутся в консоль сервера `next dev`.
