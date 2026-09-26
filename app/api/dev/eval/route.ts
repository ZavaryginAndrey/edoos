import { devEnabled, errorResponse, notFound, readField } from "@/src/dev/devOnly";
import { readEvalCase, runEvalCase } from "@/src/dev/evals";

// POST { id } — прогоняет один кейс evals/cases/<id>.json. Ошибка агента попадает в строку (pass: false).
export async function POST(request: Request) {
  if (!devEnabled()) return notFound();
  const id = await readField(request, "id");
  if (!id) return Response.json({ error: "Поле id обязательно." }, { status: 400 });

  const testCase = await readEvalCase(id).catch((error: Error) => error);
  if (testCase instanceof Error) return Response.json({ error: testCase.message }, { status: 400 });

  try {
    return Response.json(await runEvalCase(testCase));
  } catch (error) {
    return errorResponse(error);
  }
}
