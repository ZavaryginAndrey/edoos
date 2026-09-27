"use client";

import { useEffect, useState } from "react";
import { CheckIcon, ChevronDownIcon, MinusIcon, OctagonAlertIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import type { HealthChatMessage, ResultData, StageData, StageKind, Status, ToolData } from "@/src/chat/messages";
import { describeTool, MAX_ROUNDS, SourceBadge, toolIconClass, VERDICTS } from "@/components/agent-result";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// Ход работы агента в ответе чата: сверху степпер фаз (их набор известен заранее, в отличие от числа tools),
// ниже этапы из частей data-stage с вложенными вызовами из data-tool. Одинаковые вызовы собраны в группы.

type TimelineTool = ToolData & { id: string };
type TimelineStage = StageData & { id: string; tools: TimelineTool[] };

// Появление строк: мягкий въезд, без анимации при prefers-reduced-motion.
const ENTER = "animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none";

// Этапы в порядке первого появления (так их писал сервер) с tools внутри.
function collectStages(parts: HealthChatMessage["parts"]): TimelineStage[] {
  const stages = new Map<string, TimelineStage>();
  const tools: TimelineTool[] = [];
  for (const part of parts) {
    if (part.type === "data-stage" && part.id) stages.set(part.id, { ...part.data, id: part.id, tools: [] });
    if (part.type === "data-tool" && part.id) tools.push({ ...part.data, id: part.id });
  }
  for (const tool of tools) stages.get(tool.stageId)?.tools.push(tool);
  return [...stages.values()];
}

// Внутри раунда этапы идут как в задаче: данные, поиск, генерация (или доработка), проверка; итог последним.
const KIND_ORDER: Record<StageKind, number> = { profile: 0, knowledge: 1, writing: 2, revising: 2, review: 3, final: 4 };
const position = (stage: TimelineStage) => (stage.kind === "final" ? Number.MAX_SAFE_INTEGER : stage.round * 10 + KIND_ORDER[stage.kind]);

// ---------- Степпер фаз ----------

const PHASES = ["Данные", "План", "Проверка", "Сохранение"];
const PHASE_OF: Record<StageKind, number> = { profile: 0, knowledge: 0, writing: 1, revising: 1, review: 2, final: 3 };
type PhaseState = "pending" | "active" | "done" | "skipped" | "stopped" | "warning";

// Текущая фаза — самая ранняя из активных этапов (коуч ещё собирает данные, пока пишет план), иначе фаза
// последнего появившегося этапа. После ревизии степпер возвращается на «План».
function phaseStates(stages: TimelineStage[], running: boolean, result: ResultData | undefined): PhaseState[] {
  const reached = new Set(stages.map((stage) => PHASE_OF[stage.kind]));
  const active = stages.filter((stage) => stage.status === "active");
  const current = active.length
    ? Math.min(...active.map((stage) => PHASE_OF[stage.kind]))
    : stages.length
      ? PHASE_OF[stages.at(-1)!.kind]
      : 0;
  const before = (index: number): PhaseState => (reached.has(index) ? "done" : "skipped");

  if (running || !result) {
    return PHASES.map((_, index) => {
      if (index < current) return before(index);
      if (index > current) return "pending";
      return running ? "active" : "stopped";
    });
  }
  const { verdict } = result.review;
  if (verdict === "approve") return PHASES.map(() => "done");
  const review = PHASE_OF.review;
  return PHASES.map((_, index) => {
    if (index < review) return before(index);
    if (index === review) return verdict === "needs_human_professional" ? "stopped" : "warning";
    return verdict === "revise" ? "skipped" : "pending";
  });
}

function PhaseNode({ state }: { state: PhaseState }) {
  const base = "flex size-5 shrink-0 items-center justify-center rounded-full transition-colors duration-300";
  switch (state) {
    case "done":
      return (
        <span className={cn(base, "bg-foreground text-background")}>
          <CheckIcon className="size-3" strokeWidth={3} />
        </span>
      );
    case "active":
      return (
        <span className={cn(base, "ring-1 ring-foreground/30")}>
          <span className="size-2 rounded-full bg-foreground motion-safe:animate-pulse" />
        </span>
      );
    case "stopped":
      return (
        <span className={cn(base, "bg-destructive/10 text-destructive")}>
          <OctagonAlertIcon className="size-3" />
        </span>
      );
    case "warning":
      return (
        <span className={cn(base, "bg-warning/10 text-warning")}>
          <TriangleAlertIcon className="size-3" />
        </span>
      );
    case "skipped":
      return (
        <span className={cn(base, "text-muted-foreground ring-1 ring-border")}>
          <MinusIcon className="size-3" />
        </span>
      );
    default:
      return <span className={cn(base, "ring-1 ring-border")} />;
  }
}

function useElapsedSeconds(running: boolean) {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return Math.floor((now - startedAt) / 1000);
}

function PhaseStepper({ states, round, running }: { states: PhaseState[]; round: number; running: boolean }) {
  const seconds = useElapsedSeconds(running);
  return (
    <div className="flex items-center gap-4">
      <ol className="flex min-w-0 flex-1 items-center" aria-label="Фазы работы агента">
        {PHASES.map((label, index) => {
          const state = states[index];
          const muted = state === "pending" || state === "skipped";
          return (
            <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
              <PhaseNode state={state} />
              <span
                className={cn(
                  "text-sm transition-colors duration-300",
                  muted ? "hidden text-muted-foreground sm:inline" : "text-foreground",
                  state === "active" && "font-medium",
                )}
              >
                {label}
              </span>
              {index < PHASES.length - 1 && (
                <span
                  aria-hidden
                  className={cn("mx-1.5 h-px min-w-3 flex-1 transition-colors duration-500", state === "done" ? "bg-foreground/40" : "bg-border")}
                />
              )}
            </li>
          );
        })}
      </ol>
      {(round > 1 || running) && (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {round > 1 && `Раунд ${round} из ${MAX_ROUNDS}`}
          {round > 1 && running && ", "}
          {running && `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}
        </span>
      )}
    </div>
  );
}

// ---------- Этапы и вызовы ----------

function stageLabel({ kind, round, precheck }: StageData): string {
  switch (kind) {
    case "profile":
      return "Чтение профиля";
    case "knowledge":
      return "Поиск в базе знаний";
    case "writing":
      return "Генерация плана";
    case "revising":
      return `Доработка, раунд ${round}`;
    case "review":
      if (precheck) return "Проверка запроса";
      return round > 1 ? `Проверка безопасности, раунд ${round}` : "Проверка безопасности";
    case "final":
      return "Сохранение плана";
  }
}

const plural = (count: number, forms: Record<"one" | "few" | "many", string>) =>
  `${count} ${forms[new Intl.PluralRules("ru-RU").select(count) as "one" | "few" | "many"] ?? forms.few}`;
const QUERY_FORMS = { one: "запрос", few: "запроса", many: "запросов" };
const CALL_FORMS = { one: "вызов", few: "вызова", many: "вызовов" };

// «3 из 6», пока вызовы идут, и «6 запросов», когда все готовы.
function countLabel(tools: TimelineTool[]) {
  const finished = tools.filter((tool) => tool.status !== "active").length;
  if (finished < tools.length) return `${finished} из ${tools.length}`;
  return plural(tools.length, tools.every((tool) => tool.name === "searchKnowledge") ? QUERY_FORMS : CALL_FORMS);
}

// Одинаковые tools подряд и вразброс собираются в одну группу, порядок групп — по первому вызову.
function groupByTool(tools: TimelineTool[]) {
  const groups = new Map<string, TimelineTool[]>();
  for (const tool of tools) groups.set(tool.name, [...(groups.get(tool.name) ?? []), tool]);
  return [...groups.entries()].map(([name, calls]) => ({ name, calls }));
}

// Пока агент работает, этапы и группы раскрыты и только растут вниз; когда начинается план, один раз плавно
// сворачиваются. Ручное открытие или закрытие пользователем важнее.
function useRunOpen(expanded: boolean) {
  const [override, setOverride] = useState<boolean | null>(null);
  return [override ?? expanded, setOverride] as const;
}

// Высота панели анимируется через --collapsible-panel-height из Base UI: без скачков при раскрытии и сворачивании.
const PANEL =
  "h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[starting-style]:h-0 data-[ending-style]:h-0 motion-reduce:transition-none";
const TRIGGER =
  "group -mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg px-2 py-1 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 data-[disabled]:cursor-default data-[disabled]:hover:bg-transparent";

function StageNode({ status }: { status: Status }) {
  if (status === "active") return <Spinner aria-label="Выполняется" className="size-4 text-muted-foreground" />;
  if (status === "error") {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-destructive/10 text-destructive" aria-label="Ошибка">
        <XIcon className="size-3" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span className="flex size-5 items-center justify-center rounded-full bg-muted text-foreground/70" aria-label="Готово">
      <CheckIcon className="size-3" strokeWidth={3} />
    </span>
  );
}

function Chevron() {
  return <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-180" />;
}

const Count = ({ children }: { children: React.ReactNode }) => (
  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{children}</span>
);

// Структура строки не зависит от того, сколько вызовов уже пришло: этап всегда один и тот же Collapsible,
// каждый tool — одна и та же группа с ключом по имени. Новый вызов добавляет строку, а не пересоздаёт соседей.
function StageItem({ stage, last, expanded }: { stage: TimelineStage; last: boolean; expanded: boolean }) {
  const [open, setOpen] = useRunOpen(expanded);
  const { review, tools } = stage;
  const verdict = review ? VERDICTS[review.verdict] : null;
  // При needs_human_professional замечания показывает карточка специалиста под таймлайном.
  const issues = review && review.verdict !== "needs_human_professional" ? review.issues : [];
  // Этап поиска по базе знаний состоит только из searchKnowledge: он сам и есть выпадающий список запросов.
  const flat = stage.kind === "knowledge";
  const flatSource = flat ? describeTool("searchKnowledge") : null;

  return (
    <li className={cn("relative pb-3 pl-8", ENTER)}>
      {!last && <span aria-hidden className="absolute top-7 bottom-0 left-2.5 w-px bg-border" />}
      <span className="absolute top-1 left-0 flex size-5 items-center justify-center">
        <StageNode status={stage.status} />
      </span>
      <Collapsible open={open && tools.length > 0} onOpenChange={(next) => setOpen(next)}>
        <CollapsibleTrigger disabled={!tools.length} className={TRIGGER}>
          <span className={cn("font-medium", stage.status === "error" && "text-destructive")}>{stageLabel(stage)}</span>
          {tools.length > 0 && <Count>{countLabel(tools)}</Count>}
          {flatSource && tools.length > 0 && <SourceBadge kind={flatSource.kind} source={flatSource.source} />}
          {tools.length > 0 && <Chevron />}
          {review && verdict && (
            <span className="ml-auto flex shrink-0 items-center gap-2.5">
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
        </CollapsibleTrigger>
        <CollapsibleContent className={PANEL}>
          <ul className="space-y-0.5 pt-1">
            {flat
              ? tools.map((tool) => <CallRow key={tool.id} tool={tool} />)
              : groupByTool(tools).map(({ name, calls }) => <ToolGroup key={name} name={name} calls={calls} expanded={expanded} />)}
          </ul>
        </CollapsibleContent>
      </Collapsible>
      {issues.length > 0 && (
        <ul className="mt-1.5 space-y-1 text-muted-foreground">
          {issues.map((issue, index) => (
            <li key={index} className="flex gap-2.5">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
              {issue}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// Иконка вызова; пока вызов идёт — loader того же цвета.
function ToolIcon({ name, active }: { name: string; active: boolean }) {
  const { icon: Icon, kind } = describeTool(name);
  return active ? <Spinner className={cn("size-4", toolIconClass(kind))} /> : <Icon className={cn("size-4 shrink-0", toolIconClass(kind))} />;
}

// Вызовы одного tool. Пока вызов один — это обычная строка; со вторым та же строка получает счётчик и
// раскрывающийся список, loader на иконке — пока внутри есть незавершённый вызов. Имя tool — в подсказке.
function ToolGroup({ name, calls, expanded }: { name: string; calls: TimelineTool[]; expanded: boolean }) {
  const [open, setOpen] = useRunOpen(expanded);
  const many = calls.length > 1;
  const busy = calls.some((call) => call.status === "active");
  const failed = !many && calls[0].status === "error";
  const { label, kind, source, tool: toolName } = describeTool(name, many ? undefined : calls[0].query);
  return (
    <li className={ENTER}>
      <Collapsible open={open && many} onOpenChange={(next) => setOpen(next)}>
        <CollapsibleTrigger disabled={!many} title={toolName} className={cn(TRIGGER, failed && "text-destructive")}>
          <ToolIcon name={name} active={busy} />
          <span className="min-w-0">{label}</span>
          {many && <Count>{countLabel(calls)}</Count>}
          {many && <Chevron />}
          <span className="ml-auto">
            <SourceBadge kind={kind} source={source} />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className={PANEL}>
          <ul className="mt-0.5 ml-2 space-y-0.5 border-l pl-4">
            {calls.map((call) => (
              <CallRow key={call.id} tool={call} />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

// Вызов внутри группы: статус и подпись (для поиска — сам запрос).
function CallRow({ tool }: { tool: TimelineTool }) {
  const { label, kind, tool: toolName } = describeTool(tool.name, tool.query);
  return (
    <li title={toolName} className={cn("flex items-start gap-2.5 py-0.5 text-muted-foreground", ENTER)}>
      <span className="flex h-5 w-4 shrink-0 items-center justify-center">
        {tool.status === "active" ? (
          <Spinner className={cn("size-3.5", toolIconClass(kind))} />
        ) : tool.status === "error" ? (
          <XIcon className="size-3.5 text-destructive" />
        ) : (
          <CheckIcon className="size-3.5" />
        )}
      </span>
      <span className={cn("min-w-0 flex-1", tool.status === "active" && "text-foreground")}>{label}</span>
    </li>
  );
}

export function AgentProgress({
  parts,
  running,
  result,
}: {
  parts: HealthChatMessage["parts"];
  running: boolean;
  result: ResultData | undefined;
}) {
  const stages = collectStages(parts);
  const states = phaseStates(stages, running, result);
  const round = Math.max(1, ...stages.map((stage) => stage.round));
  if (!stages.length && !running) return null;

  const sorted = [...stages].sort((a, b) => position(a) - position(b));
  // Детали раскрыты, пока агент работает, и сворачиваются один раз, когда начинает приходить план.
  const expanded = running && !parts.some((part) => part.type === "text");
  return (
    <div className="space-y-4">
      <PhaseStepper states={states} round={round} running={running} />
      {sorted.length > 0 && (
        <ol>
          {sorted.map((stage, index) => (
            <StageItem key={stage.id} stage={stage} last={index === sorted.length - 1} expanded={expanded} />
          ))}
        </ol>
      )}
    </div>
  );
}
