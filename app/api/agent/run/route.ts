import { runHealthAgent } from "@/src/harness/runHealthAgent";
import { parseTestOptions } from "../test-options";

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
