import type { Agent } from "@openai/agents";
import type { CoachContext } from "../agents/healthCoach";
import type { Review } from "./validateReview";

// События одного запуска runHealthAgent для живого UI (app/api/chat). Harness только сообщает, что происходит;
// что с этим делать — решает подписчик. Без onEvent события никуда не уходят и поведение прежнее.

// Шаг коуча: номер раунда или сохранение одобренного плана.
export type CoachStep = number | "save";

export type HealthAgentEvent =
  | { type: "coach_start"; round: number }
  | { type: "coach_end"; round: number }
  // name — как видела модель: mcp_<сервер>__<tool> или локальное имя; args — JSON-строка аргументов.
  | { type: "tool_start"; step: CoachStep; callId: string; name: string; args: string }
  | { type: "tool_end"; step: CoachStep; callId: string; name: string }
  | { type: "review_start"; round: number }
  // precheck: вердикт regex-фильтра до LLM (без review_start).
  | { type: "review_end"; round: number; review: Review; precheck: boolean }
  | { type: "save_start" }
  | { type: "save_end" };

export type OnEvent = (event: HealthAgentEvent) => void;

// Ошибка подписчика (например, запись в уже закрытый стрим) не должна ронять запуск агента.
export function safeEmit(onEvent?: OnEvent): OnEvent {
  return (event) => {
    if (!onEvent) return;
    try {
      onEvent(event);
    } catch (error) {
      console.error(`onEvent(${event.type}):`, error);
    }
  };
}

// Хуки SDK на экземпляре коуча, а не на глобальном runner: параллельные запуски не видят чужих tools.
// Срабатывают и в обычном run(). Вызовы отсутствующих tools хуков не дают — как и в toolCalls.
export function emitToolEvents(agent: Agent<CoachContext>, emit: OnEvent, currentStep: () => CoachStep) {
  agent.on("agent_tool_start", (_context, _tool, { toolCall }) => {
    if (toolCall.type !== "function_call") return;
    emit({ type: "tool_start", step: currentStep(), callId: toolCall.callId, name: toolCall.name, args: toolCall.arguments });
  });
  agent.on("agent_tool_end", (_context, _tool, _result, { toolCall }) => {
    if (toolCall.type !== "function_call") return;
    emit({ type: "tool_end", step: currentStep(), callId: toolCall.callId, name: toolCall.name });
  });
}
