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
