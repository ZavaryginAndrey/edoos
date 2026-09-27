import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import type { HealthChatMessage, ResultData } from "@/src/chat/messages";
import { streamPlan } from "@/src/chat/streamPlan";
import { createTimeline } from "@/src/chat/timeline";
import { runHealthAgent, type HealthAgentResult } from "@/src/harness/runHealthAgent";
import { parseTestOptions } from "../agent/test-options";

// Чат: та же задача, что у /api/agent/run, но ответ — поток UI-сообщения AI SDK. Сначала этапы и tools
// по мере работы агента (data-stage / data-tool), затем план текстовыми дельтами и итог (data-result).
// Клиент присылает только текст последнего сообщения: каждый запуск агента независим, диалога у harness нет.

const toResult = (result: HealthAgentResult): ResultData => ({
  review: result.review,
  approved: result.review.verdict === "approve",
  rounds: result.rounds.length,
  finalScore: result.finalScore,
  improved: result.improved,
  promptVersions: result.promptVersions,
  model: result.model,
  durationMs: result.durationMs,
  actions: result.actions,
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const task = typeof body?.task === "string" ? body.task.trim() : "";
  if (!task) return Response.json({ error: "Поле task обязательно." }, { status: 400 });
  const options = parseTestOptions(body);
  if (typeof options === "string") return Response.json({ error: options }, { status: 400 });

  const stream = createUIMessageStream<HealthChatMessage>({
    execute: async ({ writer }) => {
      // Сообщение ассистента (и степпер с таймером) появляется сразу, а не после старта MCP-серверов.
      writer.write({ type: "start" });
      const timeline = createTimeline(writer);
      let result: HealthAgentResult;
      try {
        result = await runHealthAgent(task, { ...options, onEvent: timeline.handle });
      } catch (error) {
        timeline.fail();
        throw error;
      }
      // needs_human_professional — плана нет, UI покажет карточку специалиста из data-result.
      if (result.plan) await streamPlan(writer, result.plan, request.signal);
      if (request.signal.aborted) return;
      writer.write({ type: "data-result", id: "result", data: toResult(result) });
    },
    onError: (error) => {
      console.error(error);
      return error instanceof Error ? error.message : "Неизвестная ошибка";
    },
  });
  return createUIMessageStreamResponse({ stream });
}
