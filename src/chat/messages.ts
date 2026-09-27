import type { UIMessage } from "ai";
import type { PlanAction, PromptVersions, Review } from "../harness/runHealthAgent";

// Формат сообщений чата (app/api/chat → useChat). Сервер пишет части data-stage / data-tool с постоянным id
// и переписывает их по ходу запуска — AI SDK на клиенте заменяет часть с тем же id. Клиент импортирует
// отсюда только типы.

export type StageKind = "profile" | "knowledge" | "writing" | "review" | "revising" | "final";
export type Status = "active" | "done" | "error";

// Этап таймлайна. review и precheck — только у kind "review"; у "final" round = 0.
export type StageData = { kind: StageKind; round: number; status: Status; review?: Review; precheck?: boolean };

// Вызов tool коучем. name — как видела модель (mcp_<сервер>__<tool> или локальное имя), query — у searchKnowledge.
export type ToolData = { stageId: string; name: string; query?: string; status: Status };

// Итог запуска: пишется последней частью, UI показывает его под планом.
export type ResultData = {
  review: Review;
  approved: boolean;
  rounds: number;
  finalScore: number | null;
  improved: boolean;
  promptVersions: PromptVersions;
  model: string;
  durationMs: number;
  actions: PlanAction[];
};

export type HealthChatMessage = UIMessage<never, { stage: StageData; tool: ToolData; result: ResultData }>;
