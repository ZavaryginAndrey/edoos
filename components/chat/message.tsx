"use client";

import { ClockIcon, FileTextIcon, OctagonAlertIcon, TriangleAlertIcon } from "lucide-react";
import type { HealthChatMessage, ResultData } from "@/src/chat/messages";
import { CopyButton, formatDuration, MAX_ROUNDS, PlanActionButton, VERDICTS } from "@/components/agent-result";
import { Timeline } from "@/components/chat/timeline";
import { Markdown } from "@/components/markdown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const messageText = (message: HealthChatMessage) =>
  message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");

// Итог запуска (data-result) — последняя часть ответа; до конца запуска её нет.
function resultOf(message: HealthChatMessage) {
  for (const part of message.parts) if (part.type === "data-result") return part.data;
  return undefined;
}

// running — это последнее сообщение, и запуск ещё идёт.
export function ChatMessage({ message, running }: { message: HealthChatMessage; running: boolean }) {
  if (message.role === "user") {
    return (
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 whitespace-pre-wrap">
        {messageText(message)}
      </div>
    );
  }

  const plan = messageText(message);
  const result = resultOf(message);

  return (
    <div className="space-y-5">
      <Timeline parts={message.parts} running={running} />
      {result?.review.verdict === "needs_human_professional" && <SpecialistCard issues={result.review.issues} />}
      {plan && <Markdown source={plan} className="[--typeset-size:0.9375rem]" />}
      {result && <ResultFooter result={result} plan={plan} />}
    </div>
  );
}

function SpecialistCard({ issues }: { issues: string[] }) {
  return (
    <Alert variant="destructive">
      <OctagonAlertIcon />
      <AlertTitle>Требуется специалист</AlertTitle>
      <AlertDescription>
        <p>Вопросы о лекарствах, симптомах и лечении лучше обсудить с врачом — коуч не даёт по ним рекомендаций.</p>
        {issues.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}

function ResultFooter({ result, plan }: { result: ResultData; plan: string }) {
  const { review, approved, rounds, durationMs, promptVersions, actions } = result;
  const verdict = VERDICTS[review.verdict];

  return (
    <div className="space-y-3">
      {review.verdict === "revise" && plan && (
        <Alert>
          <TriangleAlertIcon className="text-warning" />
          <AlertTitle>План не прошёл ревью</AlertTitle>
          <AlertDescription>За {rounds} раунда ревьюер не одобрил план, поэтому он не сохранён в output.md.</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
        <Badge className={cn("h-6 px-2.5", verdict.className)}>
          <verdict.icon data-icon="inline-start" />
          {verdict.label}
        </Badge>
        <span>
          Оценка <span className="font-medium text-foreground tabular-nums">{review.score}</span> / 10
        </span>
        <span>
          Раунды <span className="font-medium text-foreground tabular-nums">{rounds}</span> / {MAX_ROUNDS}
        </span>
        <span className="flex items-center gap-1.5">
          <ClockIcon className="size-3.5" />
          <span className="tabular-nums">{formatDuration(durationMs)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <FileTextIcon className="size-3.5" />
          <span>
            coach <span className="font-mono">{promptVersions.coach}</span>, reviewer{" "}
            <span className="font-mono">{promptVersions.reviewer}</span>
          </span>
        </span>
        {plan && (
          <span className="ml-auto">
            <CopyButton text={plan} />
          </span>
        )}
      </div>
      {approved && actions.length > 0 && (
        <div className="space-y-3">
          {actions.map((action) => (
            <PlanActionButton key={action.server} action={action} plan={plan} />
          ))}
        </div>
      )}
    </div>
  );
}
