# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Health Coach Agent: a Next.js 16 (App Router) web app wrapping two LLM agents built on the OpenAI Agents SDK (`@openai/agents`), running against DeepSeek through its OpenAI-compatible Chat Completions API. All prompts, UI copy, logs and error messages are in Russian — keep new user-facing text in Russian.

## Commands

```bash
npm install
npm run dev          # http://localhost:3000 — must be run from the repo root (see data/ paths below)
npm run build
npx tsc --noEmit     # typecheck; there is no lint or test setup
npm run replay runs/run-XXX.json   # re-run a traced task through the current harness, print old vs new
npm run eval         # run evals/cases/*.json sequentially, PASS/FAIL table (real DeepSeek calls)
```

Required `.env` in the repo root: `DEEPSEEK_API_KEY`. Optional: `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com`), `DEEPSEEK_MODEL` (default `deepseek-v4-flash`).

There is no user-facing CLI by design (the old `index.ts` was removed): users run the agents via `POST /api/agent/run` with `{ task }` (UI or curl). `tsx` exists only for the dev scripts in `scripts/` (`replay.ts`, `eval.ts`), which call `runHealthAgent` directly and load `.env` via `--env-file-if-exists`. Round-by-round logs go to the `next dev` server console.

## Architecture

Request flow: `app/page.tsx` (client) → `app/api/agent/run/route.ts` → `runHealthAgent(task, { maxRounds = 3, minRounds = 1, promptVersions = ACTIVE_PROMPTS })` in `src/harness/runHealthAgent.ts` → returns `{ plan, review: { verdict, score, issues }, rounds: RoundState[], finalScore, improved, promptVersions, model, toolCalls, durationMs }` (`toolCalls` = names of the tools the coach called, in order, across all rounds and the save step).

`src/harness/` is split by responsibility: `runHealthAgent.ts` (orchestrator only), `validateReview.ts` (zod `ReviewSchema`, `safeParseReview`, one-retry `validateReview`), `rounds.ts` (`RoundState { round, plan, review }`, `RoundHistory`, round log line), `score.ts` (`finalScore` = score of the last `approve`, else null; `improved` = last round score > first), `promptVersions.ts` (`ACTIVE_PROMPTS` + loading `prompts/<name>.<version>.md`). `traceRun.ts` (`buildTrace` + `traceRun`: every completed run — pre-check stop included — writes `runs/run-<timestamp>.json` from `finish()`; write errors are logged, never thrown; runs that throw leave no trace). Persisted: `data/output.md`, `data/shopping.md` and `runs/*.json` (gitignored except `runs/run-example.json`). Eval cases are `evals/cases/*.json` (`{ name, task, expect: { verdict, minScore? } }`); normal-case tasks must avoid the pre-check regex words (`боль(?!ш)` is deliberately not triggered by «больше»/«большой»).

The orchestration loop in `runHealthAgent` is explicit — the two agents never talk to each other directly and there are no SDK handoffs. Only the coach has tools (see Tools below); the reviewer has none:

1. **Pre-check** — `reviewTaskSafety()` (`src/agents/safetyReviewer.ts`) is a regex filter over the raw task (medications, dosages, symptoms, pressure, heart, sugar, pregnancy, injury…). A match short-circuits with `needs_human_professional` before any LLM call or API-key check; it is recorded as round 1 with an empty plan.
2. **Up to `maxRounds` (default 3) rounds**: the coach (`src/agents/healthCoach.ts`) gets only the task, fetches what it needs via tools and writes a Markdown plan (`maxTurns: 8` — each tool round-trip is a turn); the reviewer gets only the task + plan text and returns JSON validated by `validateReview()` against the zod `ReviewSchema` (`maxTurns: 1`). Invalid JSON gets exactly one retry with a corrective suffix, then throws.
3. Verdict handling: `approve` before `minRounds` → loop continues (issues go to the coach, verdict is recorded as-is); `approve` → a save step re-runs the coach with `{ approvedPlan }` in the run context so it calls `savePlan` (if it doesn't, or alters the text, the harness writes the approved plan itself), then the plan is returned; `needs_human_professional` → returns with an empty plan; `revise` → the reviewer's `issues` plus the previous plan are appended to the coach prompt for the next round. If all rounds end in `revise`, the last plan is returned but **not** saved.

Agent instructions live in `prompts/healthCoach.<v>.md` and `prompts/safetyReviewer.<v>.md`; the active versions are `ACTIVE_PROMPTS` in `src/harness/promptVersions.ts` (read from `join(process.cwd(), "prompts")` on every request). A new prompt version = a new file + changing that constant; the versions used are returned as `promptVersions`.

Test mode (dev only): the route accepts `minRounds` and `prompts: { coach?, reviewer? }` (400 in production); the UI reads them from the URL, e.g. `/?coach=test-revise&reviewer=test-revise` runs `prompts/*.test-revise.md`, which force a revise → approve cycle.

### Tools (`src/skills/`)

Nothing from `data/` is pasted into prompts. Each file exports one `tool()` with a zod schema and a model-facing Russian description (descriptions are part of the interface — edit with care). They are a plain array `COACH_TOOLS` in `src/agents/healthCoach.ts` — no registry. Files are read from `join(process.cwd(), "data")` on every call.

- `getProfile()` → `data/profile.md`; `getRecentLog(days)` → last N `## <date>` entries of `data/log.md` (by position: dates have no year); `listFavoriteRecipes()` → `data/recipes.md`; `suggestWorkoutTemplate(goal)` → one of 4 hardcoded templates.
- `generateShoppingList(planMarkdown)` → deterministic dictionary extraction (no LLM) from the plan's `## Питание` section, sums amounts, overwrites `data/shopping.md`.
- `savePlan(markdown)` → `data/output.md`. Gated by the harness, not the prompt: `isEnabled` hides it unless the run context has `approvedPlan`; `execute` rejects text that differs from the approved plan and sets `context.saved`.
- The Safety Reviewer must stay side-effect free: no tools, no data files, only task + plan text.

The DeepSeek client is configured globally inside `runHealthAgent` on each call (`setTracingDisabled`, `setOpenAIAPI("chat_completions")`, `setDefaultOpenAIClient`).

Per the README, the prompts, pre-check and loop were ported from the earlier V0 version unchanged — treat changes to them as behavior changes, not refactors.

### UI

- `app/page.tsx` is a single client component with an `idle | running | result` state machine. It imports only the `HealthAgentResult` *type* from the harness. It duplicates `MAX_ROUNDS = 3` — keep it in sync with `DEFAULT_MAX_ROUNDS` in `src/harness/runHealthAgent.ts`. The result card shows duration, prompt versions and a collapsed round history (`components/ui/collapsible.tsx`).
- Built with **shadcn/ui** (`components.json`: style `base-nova` on Base UI primitives, `rsc: true`, lucide icons) and **Tailwind CSS v4** (via `@tailwindcss/postcss`, no `tailwind.config`). Add components with `npx shadcn@latest add <name>` — they land in `components/ui/` and are owned code; style with Tailwind utilities and theme tokens rather than new CSS. Base UI composes via the `render` prop (e.g. `<TooltipTrigger render={<Button />}>`), not Radix's `asChild`.
- `app/globals.css` is the shadcn theme: CSS variables on `:root` / `.dark` mapped through `@theme inline`. Beyond the stock tokens it adds `--success` and `--warning` (used for review verdicts). Keep the neutral palette; color is reserved for status.
- Dark mode: `next-themes` (`attribute="class"`, system default) in `components/providers.tsx`, toggle in `components/theme-toggle.tsx`. On the client the theme script gets `type="application/json"` to silence React 19's "script tag in a client component" warning — it has already run from the server HTML.
- `components/markdown.tsx` is a hand-rolled minimal Markdown renderer (headings, lists, tables, paragraphs, bold/italic/code) that renders model output as React text only — intentionally no `dangerouslySetInnerHTML` and no Markdown library. Output is wrapped in `.typeset` from `app/typeset.css` (shadcn/typeset, downloaded from ui.shadcn.com/typeset.css); tables go in `.typeset-scroll` for horizontal scroll on mobile.
- Fonts: Geist and Geist Mono (Latin + Cyrillic subsets) from `next/font/google` in `app/layout.tsx`.
- `InputGroup`'s `has-disabled:*` styles also fire for a disabled button inside it; `app/page.tsx` overrides them so the composer doesn't fade while Run Agent is disabled.
- Import alias `@/*` maps to the repo root (e.g. `@/src/harness/runHealthAgent`).
