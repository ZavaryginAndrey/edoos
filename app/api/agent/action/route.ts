import { runServerAction } from "@/src/harness/runServerAction";

// Действие по кнопке под одобренным планом: { server, plan } → коуч выполняет поручение из конфига сервера.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const server = typeof body?.server === "string" ? body.server : "";
  const plan = typeof body?.plan === "string" ? body.plan : "";
  if (!server || !plan.trim()) return Response.json({ error: "Поля server и plan обязательны." }, { status: 400 });

  try {
    return Response.json(await runServerAction(server, plan));
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    return Response.json({ error: message }, { status: 500 });
  }
}
