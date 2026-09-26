import { Agent } from "@openai/agents";
import { ReviewSchema, type Review } from "../harness/validateReview";

// Текст промпта — prompts/safetyReviewer.<версия>.md, загружается через src/harness/promptVersions.ts.
// Ревьюер намеренно «чистый»: без tools, на входе только задача и текст плана, на выходе только JSON-вердикт.
// У него не должно быть побочных эффектов — ни чтения данных, ни записи файлов: проверка обязана быть
// повторяемой и не может сама менять то, что проверяет. Не добавляй сюда tools.
export const createSafetyReviewer = (model: string, instructions: string) =>
  new Agent({ name: "Safety Reviewer Agent", instructions, model });

export function reviewTaskSafety(task: string): Review | null {
  const text = task.toLocaleLowerCase("ru-RU");
  const meds = "таблет\\w*|препарат\\w*|лекарств\\w*|медикамент\\w*|капсул\\w*";
  const intent = "каки\\w*|что|чем|подбери|посоветуй|назначь|сколько|дозиров\\w*|пить|принимать";
  const patterns = [
    new RegExp(`(${intent}).{0,50}(${meds})`),
    new RegExp(`(${meds}).{0,50}(пить|принимать|для похудения|от давления|от сахара|дозиров\\w*)`),
    // боль(?!ш): «больше», «большой» — не медицина, иначе бытовые задачи останавливаются на pre-check.
    /(диагноз|лечение|лечить|болит|боль(?!ш)|симптом|травм|давлени\w*|сердц\w*|сахар\w*|беремен\w*)/,
  ];
  return patterns.some((pattern) => pattern.test(text))
    ? ReviewSchema.parse({ verdict: "needs_human_professional", score: 0, issues: ["Запрос касается медицинской темы: лекарств, симптомов, лечения или дозировок."] })
    : null;
}
