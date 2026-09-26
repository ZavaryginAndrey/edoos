import { devEnabled, errorResponse, notFound, readField } from "@/src/dev/devOnly";
import { readTrace, replayTrace } from "@/src/dev/replay";

// POST { runId } — повторяет задачу трейса runs/<runId>.json через текущий harness.
export async function POST(request: Request) {
  if (!devEnabled()) return notFound();
  const runId = await readField(request, "runId");
  if (!runId) return Response.json({ error: "Поле runId обязательно." }, { status: 400 });

  // Ошибка чтения трейса — плохой запрос; до агента дело не доходит.
  const before = await readTrace(runId).catch((error: Error) => error);
  if (before instanceof Error) return Response.json({ error: before.message }, { status: 400 });

  try {
    return Response.json(await replayTrace(before));
  } catch (error) {
    return errorResponse(error);
  }
}
