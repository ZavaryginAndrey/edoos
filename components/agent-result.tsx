"use client";

import { useState } from "react";
import {
  BookOpenIcon,
  CheckIcon,
  ChefHatIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  ClockIcon,
  CloudSunIcon,
  CopyIcon,
  DumbbellIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  NotebookTextIcon,
  OctagonAlertIcon,
  SaveIcon,
  SearchIcon,
  ShoppingCartIcon,
  TriangleAlertIcon,
  UploadIcon,
  UserIcon,
  WrenchIcon,
} from "lucide-react";
import type { HealthAgentResult, PlanAction, Retrieval, RoundState } from "@/src/harness/runHealthAgent";
import { Markdown } from "@/components/markdown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Карточки результата runHealthAgent: главная страница и /dev (replay, evals).

// Держать в синхроне с DEFAULT_MAX_ROUNDS в src/harness/runHealthAgent.ts.
export const MAX_ROUNDS = 3;

// Подписи для tools коуча по исходному имени tool-а. Неизвестное имя показывается как есть: внешние серверы
// из src/mcp/servers.config.ts могут отдавать tools, о которых UI не знает.
const TOOLS: Record<string, { label: string; icon: typeof WrenchIcon }> = {
  read_profile: { label: "Прочитал профиль", icon: UserIcon },
  read_recent_logs: { label: "Посмотрел дневник", icon: NotebookTextIcon },
  list_recipes: { label: "Открыл любимые рецепты", icon: ChefHatIcon },
  searchKnowledge: { label: "Искал в базе знаний", icon: BookOpenIcon },
  suggestWorkoutTemplate: { label: "Подобрал шаблон тренировки", icon: DumbbellIcon },
  generateShoppingList: { label: "Составил список покупок в data/shopping.md", icon: ShoppingCartIcon },
  save_health_plan: { label: "Сохранил одобренный план в data/output.md", icon: SaveIcon },
  metno_forecast: { label: "Проверил прогноз погоды", icon: CloudSunIcon },
  write_file: { label: "Записал план в файл", icon: FilePlusIcon },
  list_allowed_directories: { label: "Проверил доступные каталоги", icon: FolderIcon },
  API_post_search: { label: "Нашёл страницу в Notion", icon: SearchIcon },
  API_post_page: { label: "Создал страницу в Notion", icon: FilePlusIcon },
  API_patch_block_children: { label: "Дописал содержимое страницы в Notion", icon: FileTextIcon },
  API_update_page_markdown: { label: "Записал план на страницу в Notion", icon: FileTextIcon },
};

// SDK показывает модели MCP-tools как mcp_<сервер>__<tool>, заменяя «-» на «_» в обеих частях
// (markdown-health → mcp_markdown_health__, API-post-page → API_post_page), поэтому ключи TOOLS — с «_».
// Имена серверов в конфиге — kebab-case, для метки источника «_» возвращаем в «-».
// Без префикса — локальные tools из src/skills/.
function parseTool(name: string) {
  const match = /^mcp_(.+?)__(.+)$/.exec(name);
  return match ? { source: match[1].replace(/_/g, "-"), tool: match[2] } : { source: "local", tool: name };
}

// Цвет вызова по типу: RAG (поиск по базе знаний) и MCP выделены, прочие локальные tools — нейтральные.
const TOOL_KINDS = {
  rag: { icon: "text-rag", badge: "border-rag/30 bg-rag/10 text-rag" },
  mcp: { icon: "text-mcp", badge: "border-mcp/30 bg-mcp/10 text-mcp" },
  local: { icon: "text-muted-foreground", badge: "" },
} as const;

function toolKind(source: string, tool: string): keyof typeof TOOL_KINDS {
  if (tool === "searchKnowledge") return "rag";
  return source === "local" ? "local" : "mcp";
}

// Строка вызова для ToolCallRow по имени tool: подпись и иконка из TOOLS, цвет и бейдж — по источнику.
// query — подпись поиска по базе знаний (таймлайн чата); без него — обычная подпись tool-а.
export function describeTool(name: string, query?: string) {
  const { source, tool } = parseTool(name);
  const kind = toolKind(source, tool);
  const { label, icon } = query !== undefined ? { label: `«${query}»`, icon: BookOpenIcon } : TOOLS[tool] ?? { label: tool, icon: WrenchIcon };
  return { icon, label, kind, source: kind === "rag" ? "rag" : source, tool };
}

export const VERDICTS = {
  approve: { label: "Одобрено", icon: CircleCheckIcon, className: "bg-success/10 text-success" },
  revise: { label: "Нужна доработка", icon: TriangleAlertIcon, className: "bg-warning/10 text-warning" },
  needs_human_professional: { label: "Нужен специалист", icon: OctagonAlertIcon, className: "bg-destructive/10 text-destructive" },
} as const;

export function Result({ data }: { data: HealthAgentResult }) {
  const { plan, review, rounds, improved, promptVersions, toolCalls, durationMs } = data;
  // В результатах, собранных до появления кнопок, поля actions нет.
  const actions = data.actions ?? [];
  // До RAG в результатах (и трейсах) не было retrievals.
  const retrievals = data.retrievals ?? [];
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

      <ToolCalls calls={toolCalls} retrievals={retrievals} />

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
            {approved && actions.length > 0 && (
              <CardFooter className="flex-col items-start gap-3 border-t">
                {actions.map((action) => (
                  <PlanActionButton key={action.server} action={action} plan={plan} />
                ))}
              </CardFooter>
            )}
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

function ToolCalls({ calls, retrievals }: { calls: string[]; retrievals: Retrieval[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Что сделал агент</CardTitle>
        <CardDescription>Инструменты, которые коуч вызвал сам, по порядку. В скобках — источник: MCP-сервер, RAG (база знаний) или local</CardDescription>
      </CardHeader>
      <CardContent>
        {calls.length ? <ToolCallList calls={calls} retrievals={retrievals} /> : <p className="text-muted-foreground">Агент не вызывал инструменты</p>}
      </CardContent>
    </Card>
  );
}

// Вызовы searchKnowledge и retrievals идут в одном порядке: n-й вызов tool-а — n-я запись retrievals.
function ToolCallList({ calls, retrievals = [] }: { calls: string[]; retrievals?: Retrieval[] }) {
  let retrievalIndex = 0;
  return (
    <ol className="space-y-1">
      {calls.map((name, index) => {
        const { source, tool } = parseTool(name);
        const kind = toolKind(source, tool);
        const retrieval = kind === "rag" ? retrievals[retrievalIndex++] : undefined;
        const { label, icon } = retrieval
          ? { label: `${retrieval.query} → ${retrieval.error ? "ошибка" : `${retrieval.chunks.length} chunks`}`, icon: BookOpenIcon }
          : TOOLS[tool] ?? { label: tool, icon: WrenchIcon };
        const row = { number: index + 1, icon, label, kind, source: kind === "rag" ? "rag" : source, tool };
        return (
          <li key={index}>
            {retrieval?.chunks.length ? (
              <Collapsible>
                <CollapsibleTrigger className="group -mx-1.5 w-[calc(100%+0.75rem)] rounded-md px-1.5 py-0.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
                  <ToolCallRow {...row} expandable />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <RetrievedChunks retrieval={retrieval} />
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <div className="py-0.5">
                <ToolCallRow {...row} />
                {retrieval?.error && <p className="pl-14 text-xs text-destructive">База знаний недоступна: {retrieval.error}</p>}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function ToolCallRow({
  number,
  icon: Icon,
  label,
  kind,
  source,
  tool,
  expandable = false,
}: {
  number: number;
  icon: typeof WrenchIcon;
  label: string;
  kind: keyof typeof TOOL_KINDS;
  source: string;
  tool: string;
  expandable?: boolean;
}) {
  return (
    <span className="flex items-center gap-3">
      <span className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{number}</span>
      <Icon className={cn("size-4 shrink-0", TOOL_KINDS[kind].icon)} />
      <span className="min-w-0 flex-1">
        {label}
        {expandable && (
          <ChevronDownIcon className="ml-1 inline size-3.5 align-[-0.125em] text-muted-foreground transition-transform group-data-[panel-open]:rotate-180" />
        )}
      </span>
      <Badge variant="outline" className={cn("font-mono text-[0.625rem]", TOOL_KINDS[kind].badge)}>[{source}]</Badge>
      <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{tool}</span>
    </span>
  );
}

// Заголовки найденных чанков — чем коуч пользовался из базы знаний.
function RetrievedChunks({ retrieval }: { retrieval: Retrieval }) {
  return (
    <ul className="space-y-0.5 pt-1 pb-1.5 pl-14 text-xs text-muted-foreground">
      {retrieval.chunks.map((chunk) => (
        <li key={`${chunk.file}/${chunk.heading}`} className="flex gap-2">
          <span className="min-w-0 flex-1 truncate">
            <span className="font-mono">{chunk.file}</span> › {chunk.heading}
          </span>
          <span className="font-mono tabular-nums">{chunk.similarity.toFixed(2)}</span>
        </li>
      ))}
    </ul>
  );
}

type ActionState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; output: string; toolCalls: string[] }
  | { status: "error"; error: string };

// Кнопка сервера «по кнопке» из конфига (например, «Сохранить в Notion»): коуч выполняет поручение
// только по явному выбору пользователя и только для одобренного плана (сверяет harness).
export function PlanActionButton({ action, plan }: { action: PlanAction; plan: string }) {
  const [state, setState] = useState<ActionState>({ status: "idle" });

  async function runAction() {
    setState({ status: "running" });
    try {
      const response = await fetch("/api/agent/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server: action.server, plan }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
      setState({ status: "done", output: json.output, toolCalls: json.toolCalls });
    } catch (error) {
      setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="w-full space-y-3">
      <Button variant="outline" size="sm" onClick={runAction} disabled={state.status === "running" || state.status === "done"}>
        {state.status === "running" ? <Spinner data-icon="inline-start" /> : state.status === "done" ? <CheckIcon data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
        {action.label}
        <span className="font-mono text-[0.625rem] text-muted-foreground">[{action.server}]</span>
      </Button>
      {state.status === "error" && <p className="text-destructive">{state.error}</p>}
      {state.status === "done" && (
        <div className="space-y-2">
          {state.output && <p className="text-muted-foreground">{state.output}</p>}
          {state.toolCalls.length > 0 && <ToolCallList calls={state.toolCalls} />}
        </div>
      )}
    </div>
  );
}

export const formatDuration = (ms: number) =>
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

export function CopyButton({ text }: { text: string }) {
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
