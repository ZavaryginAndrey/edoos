"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, CircleAlertIcon, HistoryIcon, ListChecksIcon, PlayIcon, RotateCcwIcon, SquareIcon } from "lucide-react";
import type { EvalCase, EvalRow } from "@/src/dev/evals";
import type { ReplayResult, TraceSummary } from "@/src/dev/replay";
import { Result, VERDICTS } from "@/components/agent-result";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// Каждый запуск — реальные запросы в DeepSeek, поэтому одновременно идет только один (и харнесс
// настраивает клиента глобально). busy — ключ текущего запуска: "eval:<id>" или "replay:<runId>".
type EvalState = { status: "running" } | { status: "done"; row: EvalRow } | { status: "error"; error: string };
type ReplayState = { status: "running"; runId: string } | { status: "done"; data: ReplayResult } | { status: "error"; runId: string; error: string };

const TRACES_SHOWN = 8;

// expected — подпись ожидания, посчитанная на сервере (src/dev/evals.ts в клиентский бандл не идет).
type CaseView = EvalCase & { expected: string };

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
  return json as T;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function DevConsole({ traces, cases }: { traces: TraceSummary[]; cases: CaseView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const stopRequested = useRef(false);
  const [evals, setEvals] = useState<Record<string, EvalState>>({});
  const [selectedEval, setSelectedEval] = useState<string | null>(null);
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const locked = busy !== null || runningAll;

  async function runEval(id: string) {
    setBusy(`eval:${id}`);
    setEvals((current) => ({ ...current, [id]: { status: "running" } }));
    try {
      const row = await post<EvalRow>("/api/dev/eval", { id });
      setEvals((current) => ({ ...current, [id]: { status: "done", row } }));
    } catch (error) {
      setEvals((current) => ({ ...current, [id]: { status: "error", error: errorText(error) } }));
    } finally {
      setBusy(null);
      // Запуск записал новый трейс в runs/ — перечитываем список на сервере.
      router.refresh();
    }
  }

  async function runAll() {
    stopRequested.current = false;
    setRunningAll(true);
    setSelectedEval(null);
    for (const testCase of cases) {
      if (stopRequested.current) break;
      await runEval(testCase.id);
    }
    setRunningAll(false);
  }

  async function runReplay(runId: string) {
    setBusy(`replay:${runId}`);
    setReplay({ status: "running", runId });
    try {
      setReplay({ status: "done", data: await post<ReplayResult>("/api/dev/replay", { runId }) });
    } catch (error) {
      setReplay({ status: "error", runId, error: errorText(error) });
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col px-4 pb-24">
      <header className="flex h-16 items-center justify-between">
        <Link href="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2.5 text-muted-foreground")}>
          <ArrowLeftIcon />
          Health Coach
        </Link>
        <ThemeToggle />
      </header>

      <section className="pt-8 sm:pt-12">
        <h1 className="text-3xl font-semibold tracking-tight">Dev-консоль</h1>
        <p className="mt-3 max-w-xl text-pretty text-muted-foreground">
          Evals и replay через текущий harness и активные промпты. Каждый запуск — реальные запросы в DeepSeek и
          новый трейс в <span className="font-mono text-sm">runs/</span>.
        </p>
      </section>

      <EvalsSection
        cases={cases}
        evals={evals}
        busy={busy}
        locked={locked}
        runningAll={runningAll}
        selected={selectedEval}
        onRun={async (id) => {
          await runEval(id);
          setSelectedEval(id);
        }}
        onRunAll={runAll}
        onStop={() => (stopRequested.current = true)}
        onSelect={(id) => setSelectedEval((current) => (current === id ? null : id))}
      />

      <ReplaySection traces={traces} replay={replay} busy={busy} locked={locked} onRun={runReplay} />
    </div>
  );
}

function SectionHeader({ icon: Icon, title, description, children }: {
  icon: typeof PlayIcon;
  title: string;
  description: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Icon className="size-4.5 text-muted-foreground" />
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function EvalsSection({ cases, evals, busy, locked, runningAll, selected, onRun, onRunAll, onStop, onSelect }: {
  cases: CaseView[];
  evals: Record<string, EvalState>;
  busy: string | null;
  locked: boolean;
  runningAll: boolean;
  selected: string | null;
  onRun: (id: string) => void;
  onRunAll: () => void;
  onStop: () => void;
  onSelect: (id: string) => void;
}) {
  const rows = Object.values(evals).flatMap((state) => (state.status === "done" ? [state.row] : []));
  const passed = rows.filter((row) => row.pass).length;
  const selectedState = selected ? evals[selected] : undefined;
  const selectedCase = cases.find((testCase) => testCase.id === selected);

  return (
    <section className="mt-12">
      <SectionHeader
        icon={ListChecksIcon}
        title="Evals"
        description={
          <>
            <span className="font-mono">evals/cases/</span> · {cases.length} кейсов, по очереди
            {rows.length > 0 && (
              <>
                {" · "}
                <span className={cn("font-medium", passed === rows.length ? "text-success" : "text-destructive")}>
                  {passed}/{rows.length} PASS
                </span>
              </>
            )}
          </>
        }
      >
        {runningAll ? (
          <Button variant="outline" size="sm" onClick={onStop}>
            <SquareIcon />
            Остановить после текущего
          </Button>
        ) : (
          <Button size="sm" onClick={onRunAll} disabled={locked || !cases.length}>
            <PlayIcon />
            Запустить все
          </Button>
        )}
      </SectionHeader>

      {cases.length ? (
        <ul className="mt-4 divide-y rounded-xl border bg-card">
          {cases.map((testCase) => {
            const state = evals[testCase.id];
            const row = state?.status === "done" ? state.row : undefined;
            return (
              <li
                key={testCase.id}
                className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3", selected === testCase.id && "bg-muted/50")}
              >
                <EvalStatus state={state} />
                <div className="min-w-0 flex-1 truncate font-medium">{testCase.name}</div>
                {state?.status === "running" && <Elapsed />}
                {row?.result && (
                  <Button variant="ghost" size="sm" onClick={() => onSelect(testCase.id)}>
                    {selected === testCase.id ? "Скрыть" : "Подробнее"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Запустить кейс ${testCase.name}`}
                  onClick={() => onRun(testCase.id)}
                  disabled={locked}
                >
                  {busy === `eval:${testCase.id}` ? <Spinner aria-label="Идет прогон" /> : state ? <RotateCcwIcon /> : <PlayIcon />}
                </Button>
                {/* Подробности — второй строкой под именем (отступ = ширина бейджа статуса + gap). */}
                <div className="basis-full pl-17 text-xs text-muted-foreground">
                  ожидание <span className="font-mono">{testCase.expected}</span>
                  {row && (
                    <>
                      {" · "}факт <span className="font-mono">{row.actual}</span>
                      {" · "}<span className="tabular-nums">{row.seconds} с</span>
                    </>
                  )}
                  {row?.reason && <div className="mt-0.5 text-destructive">{row.reason}</div>}
                  {state?.status === "error" && <div className="mt-0.5 text-destructive">{state.error}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">В evals/cases/ нет кейсов.</p>
      )}

      {selectedCase && selectedState?.status === "done" && selectedState.row.result && (
        <div className="mt-6 space-y-4 animate-in fade-in-0 slide-in-from-bottom-1">
          <TaskQuote label={`Кейс ${selectedCase.name}`} task={selectedCase.task} />
          <Result data={selectedState.row.result} />
        </div>
      )}
    </section>
  );
}

function EvalStatus({ state }: { state: EvalState | undefined }) {
  if (!state) return <Badge variant="outline" className="w-14 text-muted-foreground">—</Badge>;
  if (state.status === "running") return <Badge variant="outline" className="w-14"><Spinner aria-label="Идет прогон" className="size-3" /></Badge>;
  if (state.status === "error" || !state.row.pass) return <Badge className="w-14 bg-destructive/10 text-destructive">FAIL</Badge>;
  return <Badge className="w-14 bg-success/10 text-success">PASS</Badge>;
}

function ReplaySection({ traces, replay, busy, locked, onRun }: {
  traces: TraceSummary[];
  replay: ReplayState | null;
  busy: string | null;
  locked: boolean;
  onRun: (runId: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? traces : traces.slice(0, TRACES_SHOWN);

  return (
    <section className="mt-16">
      <SectionHeader
        icon={HistoryIcon}
        title="Replay"
        description={<>Задача из трейса <span className="font-mono">runs/</span> заново через текущий harness: было / стало</>}
      />

      {traces.length ? (
        <ul className="mt-4 divide-y rounded-xl border bg-card">
          {shown.map((trace) => {
            const verdict = VERDICTS[trace.verdict];
            return (
              <li key={trace.runId} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                    <time dateTime={trace.createdAt} suppressHydrationWarning>{formatDate(trace.createdAt)}</time>
                    <Badge className={cn("h-5 px-2", verdict.className)}>
                      <verdict.icon data-icon="inline-start" />
                      {verdict.label}
                    </Badge>
                    {trace.finalScore !== null && <span className="tabular-nums">score {trace.finalScore}</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm">{trace.task}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => onRun(trace.runId)} disabled={locked}>
                  {busy === `replay:${trace.runId}` ? <Spinner aria-label="Идет replay" /> : <RotateCcwIcon />}
                  Replay
                </Button>
              </li>
            );
          })}
          {traces.length > TRACES_SHOWN && (
            <li className="px-4 py-2">
              <Button variant="ghost" size="sm" className="-mx-2.5 text-muted-foreground" onClick={() => setShowAll(!showAll)}>
                {showAll ? "Свернуть" : `Показать все (${traces.length})`}
              </Button>
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          В runs/ пока нет трейсов — запустите агента на главной или прогоните evals.
        </p>
      )}

      <div aria-live="polite" className="mt-6 empty:hidden">
        {replay?.status === "running" && (
          <div className="flex items-center gap-2.5 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
            <Spinner aria-label="Идет replay" />
            Replay <span className="font-mono text-xs">{replay.runId}</span>
            <span className="ml-auto"><Elapsed /></span>
          </div>
        )}
        {replay?.status === "error" && (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Replay {replay.runId} не удался</AlertTitle>
            <AlertDescription>{replay.error}</AlertDescription>
          </Alert>
        )}
        {replay?.status === "done" && <ReplayReport data={replay.data} />}
      </div>
    </section>
  );
}

function ReplayReport({ data }: { data: ReplayResult }) {
  const { before, rows, changed, result } = data;
  return (
    <div className="space-y-4 animate-in fade-in-0 slide-in-from-bottom-1">
      <TaskQuote label={`Replay ${before.runId}`} task={before.task} />

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="w-6 py-2 pl-4 font-medium" />
              <th className="py-2 pr-4 font-medium">поле</th>
              <th className="py-2 pr-4 font-medium">было</th>
              <th className="py-2 pr-4 font-medium">стало</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.name} className={cn("align-top", row.changed && "bg-warning/5")}>
                <td className="py-2 pl-4 text-warning">{row.changed ? "≠" : ""}</td>
                <td className="py-2 pr-4 font-medium whitespace-nowrap">{row.name}</td>
                <td className="py-2 pr-4 font-mono text-xs break-words text-muted-foreground">{row.before}</td>
                <td className="py-2 pr-4 font-mono text-xs break-words">{row.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t px-4 py-2.5 text-sm">
          {changed.length ? (
            <>Изменилось: <span className="font-medium text-warning">{changed.join(", ")}</span></>
          ) : (
            <span className="text-muted-foreground">Существенных изменений нет (durationMs не в счет).</span>
          )}
        </p>
      </div>

      <Result data={result} />
    </div>
  );
}

function TaskQuote({ label, task }: { label: string; task: string }) {
  return (
    <div className="rounded-xl border border-dashed px-4 py-3">
      <div className="font-mono text-xs text-muted-foreground">{label}</div>
      <p className="mt-1 text-sm text-pretty">{task}</p>
    </div>
  );
}

function Elapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="font-mono text-xs text-muted-foreground tabular-nums">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
