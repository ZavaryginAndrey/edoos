import type { UIMessageStreamWriter } from "ai";
import type { CoachStep, HealthAgentEvent } from "../harness/events";
import type { HealthChatMessage, StageData, StageKind, ToolData } from "./messages";

// События runHealthAgent → части таймлайна чата. В раунде 1 tools разложены по смыслу: данные пользователя,
// поиск в базе знаний, всё остальное — генерация плана. С раунда 2 все tools раунда — в «Доработке»,
// tools шага сохранения — в «Итоговом плане». Каждое изменение пишется с тем же id, клиент обновляет строку.

export type ChatWriter = Pick<UIMessageStreamWriter<HealthChatMessage>, "write">;

// Tools сервера markdown-health, которые читают данные пользователя: этап «Чтение профиля».
const PROFILE_TOOLS = new Set([
  "mcp_markdown_health__read_profile",
  "mcp_markdown_health__read_recent_logs",
  "mcp_markdown_health__list_recipes",
]);
const KNOWLEDGE_TOOL = "searchKnowledge";

const stageId = (kind: StageKind, round: number) => (kind === "final" ? "final" : `r${round}-${kind}`);

function toolStage(step: CoachStep, name: string): { kind: StageKind; round: number } {
  if (step === "save") return { kind: "final", round: 0 };
  if (step > 1) return { kind: "revising", round: step };
  if (PROFILE_TOOLS.has(name)) return { kind: "profile", round: 1 };
  if (name === KNOWLEDGE_TOOL) return { kind: "knowledge", round: 1 };
  return { kind: "writing", round: 1 };
}

// Запрос к базе знаний из аргументов вызова; битый JSON — строка без запроса, а не ошибка.
function knowledgeQuery(name: string, args: string): string | undefined {
  if (name !== KNOWLEDGE_TOOL) return undefined;
  try {
    const { query } = JSON.parse(args) as { query?: unknown };
    return typeof query === "string" ? query : undefined;
  } catch {
    return undefined;
  }
}

export function createTimeline(writer: ChatWriter) {
  const stages = new Map<string, StageData>();
  const tools = new Map<string, ToolData>();

  const writeStage = (id: string, data: StageData) => {
    stages.set(id, data);
    writer.write({ type: "data-stage", id, data });
  };
  const writeTool = (id: string, data: ToolData) => {
    tools.set(id, data);
    writer.write({ type: "data-tool", id, data });
  };
  const setStageStatus = (id: string, status: StageData["status"]) => {
    const stage = stages.get(id);
    if (stage && stage.status !== status) writeStage(id, { ...stage, status });
  };
  // Этап создаётся при первом событии; уже закрытый (коуч снова прочитал профиль) открывается заново.
  const openStage = (kind: StageKind, round: number) => {
    const id = stageId(kind, round);
    const stage = stages.get(id);
    if (stage?.status !== "active") writeStage(id, { ...stage, kind, round, status: "active" });
    return id;
  };
  const closeIfIdle = (id: string) => {
    const busy = [...tools.values()].some((tool) => tool.stageId === id && tool.status === "active");
    if (!busy) setStageStatus(id, "done");
  };

  function handle(event: HealthAgentEvent) {
    switch (event.type) {
      case "coach_start":
        openStage(event.round === 1 ? "writing" : "revising", event.round);
        break;
      case "tool_start": {
        const { kind, round } = toolStage(event.step, event.name);
        const id = openStage(kind, round);
        const query = knowledgeQuery(event.name, event.args);
        writeTool(`${id}-${event.callId}`, { stageId: id, name: event.name, ...(query === undefined ? {} : { query }), status: "active" });
        break;
      }
      case "tool_end": {
        const { kind, round } = toolStage(event.step, event.name);
        const id = stageId(kind, round);
        const toolId = `${id}-${event.callId}`;
        const tool = tools.get(toolId);
        if (tool) writeTool(toolId, { ...tool, status: "done" });
        // Генерация, доработка и итог закрываются своими событиями, профиль и поиск — когда их tools закончились.
        if (kind === "profile" || kind === "knowledge") closeIfIdle(id);
        break;
      }
      case "coach_end":
        for (const [id, stage] of stages) {
          if (stage.round === event.round && stage.kind !== "review") setStageStatus(id, "done");
        }
        break;
      case "review_start":
        openStage("review", event.round);
        break;
      case "review_end":
        // Pre-check приходит без review_start: этап создаётся сразу завершённым.
        writeStage(stageId("review", event.round), {
          kind: "review",
          round: event.round,
          status: "done",
          review: event.review,
          precheck: event.precheck,
        });
        break;
      case "save_start":
        openStage("final", 0);
        break;
      case "save_end":
        setStageStatus("final", "done");
        break;
    }
  }

  // Запуск упал: всё, что ещё выполнялось, помечается ошибкой.
  function fail() {
    for (const [id, tool] of tools) if (tool.status === "active") writeTool(id, { ...tool, status: "error" });
    for (const [id, stage] of stages) if (stage.status === "active") writeStage(id, { ...stage, status: "error" });
  }

  return { handle, fail };
}
