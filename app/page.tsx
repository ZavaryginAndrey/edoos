"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpIcon, CircleAlertIcon, FlaskConicalIcon, LeafIcon, TerminalIcon } from "lucide-react";
import type { HealthAgentResult } from "@/src/harness/runHealthAgent";
import { MAX_ROUNDS, Result } from "@/components/agent-result";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type State =
  | { status: "idle" }
  | { status: "running" }
  | { status: "result"; data: HealthAgentResult }
  | { status: "result"; error: string };

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
