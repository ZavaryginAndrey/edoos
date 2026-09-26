// /dev и /api/dev/* доступны только вне production: каждый запуск — реальные запросы в DeepSeek.
export const devEnabled = () => process.env.NODE_ENV !== "production";

export const notFound = () => Response.json({ error: "Не найдено." }, { status: 404 });

export function errorResponse(error: unknown) {
  console.error(error);
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  return Response.json({ error: message }, { status: 500 });
}

// Читает строковое поле из JSON-тела; null — если тела или поля нет.
export async function readField(request: Request, field: string): Promise<string | null> {
  const body = await request.json().catch(() => null);
  const value = body?.[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
