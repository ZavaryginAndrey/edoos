"use client";

import { useEffect, useState } from "react";
import {
  ArrowUpIcon,
  CheckIcon,
  ChefHatIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  ClockIcon,
  CopyIcon,
  DumbbellIcon,
  FileTextIcon,
  FlaskConicalIcon,
  LeafIcon,
  NotebookTextIcon,
  OctagonAlertIcon,
  SaveIcon,
  ShoppingCartIcon,
  TriangleAlertIcon,
  UserIcon,
  WrenchIcon,
} from "lucide-react";
import type { HealthAgentResult, RoundState } from "@/src/harness/runHealthAgent";
import { Markdown } from "@/components/markdown";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type State =
  | { status: "idle" }
  | { status: "running" }
  | { status: "result"; data: HealthAgentResult }
  | { status: "result"; error: string };

// Держать в синхроне с DEFAULT_MAX_ROUNDS в src/harness/runHealthAgent.ts.
const MAX_ROUNDS = 3;

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

// Подписи для tools из src/skills/. Неизвестное имя показывается как есть.
const TOOLS: Record<string, { label: string; icon: typeof WrenchIcon }> = {
  getProfile: { label: "Прочитал профиль", icon: UserIcon },
  getRecentLog: { label: "Посмотрел дневник", icon: NotebookTextIcon },
  listFavoriteRecipes: { label: "Открыл любимые рецепты", icon: ChefHatIcon },
  suggestWorkoutTemplate: { label: "Подобрал шаблон тренировки", icon: DumbbellIcon },
  generateShoppingList: { label: "Составил список покупок в data/shopping.md", icon: ShoppingCartIcon },
  savePlan: { label: "Сохранил одобренный план в data/output.md", icon: SaveIcon },
};

const VERDICTS = {
  approve: { label: "Одобрено", icon: CircleCheckIcon, className: "bg-success/10 text-success" },
  revise: { label: "Нужна доработка", icon: TriangleAlertIcon, className: "bg-warning/10 text-warning" },
  needs_human_professional: { label: "Нужен специалист", icon: OctagonAlertIcon, className: "bg-destructive/10 text-destructive" },
} as const;

export default function Home() {
  const [task, setTask] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [testOptions, setTestOptions] = useState<TestOptions | null>(null);
  useEffect(() => setTestOptions(readTestOptions(window.location.search)), []);
  const running = state.status === "running";
  const canRun = !running && Boolean(task.trim());

  async function runAgent() {
    if (!canRun) return;
    setState({ status: "running" });
    try {
      const response = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, ...testOptions }),
      });
      const json = await response.json();
      setState(response.ok ? { status: "result", data: json } : { status: "result", error: json.error });
    } catch (error) {
      setState({ status: "result", error: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-2xl flex-col px-4 pb-24">
      <header className="flex h-16 items-center justify-between">
        <div className="flex items-center gap-2.5 text-sm font-medium">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <LeafIcon className="size-4" />
          </span>
          Health Coach
        </div>
        <ThemeToggle />
      </header>

      <section className="pt-12 sm:pt-20">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Персональный план без лишней воды
        </h1>
        <p className="mt-3 max-w-xl text-pretty text-muted-foreground">
          Коуч составляет план по вашему профилю и дневнику, Safety Reviewer проверяет его на безопасность —
          до {MAX_ROUNDS} раундов правок.
        </p>
      </section>

      <form
        className="mt-8"
        onSubmit={(event) => {
          event.preventDefault();
          runAgent();
        }}
      >
        {/* has-disabled:* у InputGroup срабатывает и на заблокированную кнопку — поле при этом гаснуть не должно. */}
        <InputGroup className="bg-background shadow-xs has-disabled:bg-background has-disabled:opacity-100 dark:bg-input/30 dark:has-disabled:bg-input/30">
          <InputGroupTextarea
            value={task}
            onChange={(event) => setTask(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                runAgent();
              }
            }}
            placeholder="Например: составь план питания на завтра"
            aria-label="Задача для коуча"
            className="min-h-24 px-3.5 pt-3 text-base md:text-base"
          />
          <InputGroupAddon align="block-end" className="gap-3 px-3 pb-3">
            <span className="hidden items-center gap-1.5 text-xs font-normal sm:flex">
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>Enter</Kbd>
              </KbdGroup>
              запустить
            </span>
            <InputGroupButton type="submit" variant="default" size="sm" className="ml-auto" disabled={!canRun}>
              {running ? <Spinner aria-label="Загрузка" /> : <ArrowUpIcon />}
              {running ? "Работает…" : "Run Agent"}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <Button
            key={suggestion}
            variant="outline"
            size="sm"
            className="rounded-full font-normal text-muted-foreground"
            onClick={() => setTask(suggestion)}
            disabled={running}
          >
            {suggestion}
          </Button>
        ))}
      </div>

      {testOptions && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <FlaskConicalIcon className="size-3.5" />
            Тестовый режим
          </span>
          {testOptions.prompts?.coach && <span>coach <span className="font-mono">{testOptions.prompts.coach}</span></span>}
          {testOptions.prompts?.reviewer && <span>reviewer <span className="font-mono">{testOptions.prompts.reviewer}</span></span>}
          {testOptions.minRounds !== undefined && <span>minRounds <span className="font-mono">{testOptions.minRounds}</span></span>}
        </div>
      )}

      <div aria-live="polite" className="mt-10 empty:hidden">
        {running && <Running />}
        {state.status === "result" && "error" in state && (
          <Alert variant="destructive" className="animate-in fade-in-0 slide-in-from-bottom-1">
            <CircleAlertIcon />
            <AlertTitle>Не удалось получить план</AlertTitle>
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        {state.status === "result" && "data" in state && <Result data={state.data} />}
      </div>
    </div>
  );
}

function Running() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Card className="animate-in fade-in-0 slide-in-from-bottom-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Spinner aria-label="Загрузка" className="text-muted-foreground" />
          Агент работает
        </CardTitle>
        <CardDescription>Коуч собирает нужные данные и пишет план, ревьюер проверяет. Обычно это занимает до пары минут.</CardDescription>
        <CardAction className="font-mono text-sm text-muted-foreground tabular-nums">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {["w-11/12", "w-4/5", "w-full", "w-3/5"].map((width) => (
          <Skeleton key={width} className={cn("h-3.5", width)} />
        ))}
      </CardContent>
    </Card>
  );
}

function Result({ data }: { data: HealthAgentResult }) {
  const { plan, review, rounds, improved, promptVersions, toolCalls, durationMs } = data;
  const verdict = VERDICTS[review.verdict];
  const approved = review.verdict === "approve";
  const needsHuman = review.verdict === "needs_human_professional";

  return (
    <div className="space-y-4 animate-in fade-in-0 slide-in-from-bottom-1">
      {needsHuman && (
        <Alert variant="destructive">
          <OctagonAlertIcon />
          <AlertTitle>Этот запрос требует консультации специалиста</AlertTitle>
          <AlertDescription>
            Вопросы о лекарствах, симптомах и лечении лучше обсудить с врачом — коуч не даёт по ним рекомендаций.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Safety review</CardTitle>
          <CardDescription>Проверка плана перед сохранением</CardDescription>
          <CardAction>
            <Badge className={cn("h-6 px-2.5", verdict.className)}>
              <verdict.icon data-icon="inline-start" />
              {verdict.label}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-6">
            <Stat label="Оценка" value={review.score} max={10}>
              <Progress value={review.score * 10} aria-label="Оценка ревьюера" />
            </Stat>
            <Stat label="Раунды" value={rounds.length} max={MAX_ROUNDS}>
              <div className="flex gap-1" aria-hidden>
                {Array.from({ length: MAX_ROUNDS }, (_, index) => (
                  <span key={index} className={cn("h-1 flex-1 rounded-full", index < rounds.length ? "bg-primary" : "bg-muted")} />
                ))}
              </div>
            </Stat>
          </div>

          <Separator />

          <div>
            <div className="text-xs font-medium text-muted-foreground">Замечания</div>
            {review.issues.length ? (
              <ul className="mt-2.5 space-y-2">
                {review.issues.map((issue, index) => (
                  <li key={index} className="flex gap-2.5">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />
                    {issue}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2.5 flex items-center gap-2 text-muted-foreground">
                <CheckIcon className="size-4 text-success" />
                Замечаний нет
              </p>
            )}
          </div>

          <Separator />

          <RoundHistory rounds={rounds} improved={improved} />
        </CardContent>
        <CardFooter className="flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ClockIcon className="size-3.5" />
            <span className="tabular-nums">{formatDuration(durationMs)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <FileTextIcon className="size-3.5" />
            <span>
              Промпты: coach <span className="font-mono">{promptVersions.coach}</span>, reviewer{" "}
              <span className="font-mono">{promptVersions.reviewer}</span>
            </span>
          </span>
        </CardFooter>
      </Card>

      <ToolCalls calls={toolCalls} />

      {!needsHuman && plan && (
        <>
          {!approved && (
            <Alert>
              <TriangleAlertIcon className="text-warning" />
              <AlertTitle>План не прошёл ревью</AlertTitle>
              <AlertDescription>
                За {rounds.length} раунда ревьюер не одобрил план, поэтому он не сохранён в output.md.
              </AlertDescription>
            </Alert>
          )}
          <Card>
            <CardHeader className="border-b">
              <CardTitle>План</CardTitle>
              <CardDescription>{approved ? "Сохранён в data/output.md" : "Черновик, не сохранён"}</CardDescription>
              <CardAction>
                <CopyButton text={plan} />
              </CardAction>
            </CardHeader>
            <CardContent>
              <Markdown source={plan} hideTitle className="[--typeset-size:0.9375rem]" />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function RoundHistory({ rounds, improved }: { rounds: RoundState[]; improved: boolean }) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className="group -mx-2.5 w-[calc(100%+1.25rem)] justify-start" />}
      >
        <span className="text-xs font-medium text-muted-foreground">История раундов</span>
        <span className="text-xs text-muted-foreground tabular-nums">{rounds.length}</span>
        {improved && <span className="text-xs font-normal text-success">score вырос</span>}
        <ChevronDownIcon className="ml-auto text-muted-foreground transition-transform group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 divide-y">
          {rounds.map(({ round, review }) => {
            const verdict = VERDICTS[review.verdict];
            return (
              <li key={round} className="flex items-center gap-3 py-2">
                <span className="w-16 text-muted-foreground">Раунд {round}</span>
                <Badge className={cn("h-5 px-2", verdict.className)}>
                  <verdict.icon data-icon="inline-start" />
                  {verdict.label}
                </Badge>
                <span className="ml-auto font-medium tabular-nums">
                  {review.score}
                  <span className="text-muted-foreground font-normal"> / 10</span>
                </span>
              </li>
            );
          })}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolCalls({ calls }: { calls: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Что сделал агент</CardTitle>
        <CardDescription>Инструменты, которые коуч вызвал сам, по порядку</CardDescription>
      </CardHeader>
      <CardContent>
        {calls.length ? (
          <ol className="space-y-2">
            {calls.map((name, index) => {
              const { label, icon: Icon } = TOOLS[name] ?? { label: name, icon: WrenchIcon };
              return (
                <li key={index} className="flex items-center gap-3">
                  <span className="w-4 text-right text-xs text-muted-foreground tabular-nums">{index + 1}</span>
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">{label}</span>
                  <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{name}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-muted-foreground">Агент не вызывал инструменты</p>
        )}
      </CardContent>
    </Card>
  );
}

const formatDuration = (ms: number) =>
  `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(ms / 1000)} с`;

function Stat({ label, value, max, children }: { label: string; value: number; max: number; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">
        {value}
        <span className="text-sm font-normal text-muted-foreground"> / {max}</span>
      </div>
      {children}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Копировать план" onClick={copy} />}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </TooltipTrigger>
      <TooltipContent>{copied ? "Скопировано" : "Копировать"}</TooltipContent>
    </Tooltip>
  );
}
