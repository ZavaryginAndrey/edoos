import { ACTIVE_PROMPTS } from "@/src/harness/promptVersions";
import { runHealthAgent, type RunOptions } from "@/src/harness/runHealthAgent";

// Тестовые параметры (minRounds, версии промптов) принимаются только вне production.
function parseTestOptions(body: Record<string, unknown>): RunOptions | string {
  const { minRounds, prompts } = body;
  if (minRounds === undefined && prompts === undefined) return {};
  if (process.env.NODE_ENV === "production") return "Тестовые параметры доступны только в dev-режиме.";

  const options: RunOptions = {};
  if (minRounds !== undefined) {
    if (typeof minRounds !== "number") return "minRounds должен быть числом.";
    options.minRounds = minRounds;
  }
  if (prompts !== undefined) {
    const { coach, reviewer } = (prompts ?? {}) as Record<string, unknown>;
    if ((coach !== undefined && typeof coach !== "string") || (reviewer !== undefined && typeof reviewer !== "string")) {
      return "prompts.coach и prompts.reviewer должны быть строками.";
    }
    options.promptVersions = { coach: coach ?? ACTIVE_PROMPTS.coach, reviewer: reviewer ?? ACTIVE_PROMPTS.reviewer };
  }
  return options;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const task = typeof body?.task === "string" ? body.task.trim() : "";
  if (!task) return Response.json({ error: "Поле task обязательно." }, { status: 400 });
  const options = parseTestOptions(body);
  if (typeof options === "string") return Response.json({ error: options }, { status: 400 });

  try {
    return Response.json(await runHealthAgent(task, options));
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    return Response.json({ error: message }, { status: 500 });
  }
}
