import { z } from "zod";

export const ReviewSchema = z.object({
  verdict: z.enum(["approve", "revise", "needs_human_professional"]),
  score: z.number().min(0).max(10), issues: z.array(z.string()),
});
export type Review = z.infer<typeof ReviewSchema>;

const RETRY_SUFFIX = "\n\nПредыдущий ответ был невалидным JSON. Верни только JSON по схеме.";

// Снимает markdown-обёртку ```json и проверяет ответ по схеме; при ошибке возвращает null, а не бросает.
export function safeParseReview(raw: string): Review | null {
  const json = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = ReviewSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ask(retrySuffix) вызывает ревьюера. Невалидный ответ получает ровно один ретрай с корректирующим суффиксом.
export async function validateReview(ask: (retrySuffix: string) => Promise<string>): Promise<Review> {
  const review = safeParseReview(await ask(""));
  if (review) return review;

  console.log("Reviewer вернул невалидный JSON, повторяю ревью один раз.");
  const raw = await ask(RETRY_SUFFIX);
  const retried = safeParseReview(raw);
  if (retried) return retried;
  throw new Error(`Reviewer вернул невалидный JSON после ретрая:\n${raw}`);
}
