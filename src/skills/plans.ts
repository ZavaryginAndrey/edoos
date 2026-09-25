import { tool, type RunContext } from "@openai/agents";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const OUTPUT_PATH = join(process.cwd(), "data", "output.md");

// Контекст запуска коуча. Заполняет только harness: approvedPlan появляется после approve ревьюера,
// saved выставляет сам tool — по нему harness проверяет, что сохранение действительно произошло.
export type CoachContext = { approvedPlan?: string; saved?: boolean };

const normalize = (markdown: string) => markdown.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();

export async function writePlan(markdown: string): Promise<void> {
  await writeFile(OUTPUT_PATH, `${normalize(markdown)}\n`, "utf8");
}

// Почему «только после approve» обеспечивает harness, а не промпт: промпт — это просьба, модель может
// её проигнорировать или решить, что план «и так хороший». Коуч к тому же работает до ревью, а вердикт
// знает только harness. Поэтому гейт двойной и детерминированный:
// 1) isEnabled — до approve tool вообще не передаётся модели, вызвать его нечем;
// 2) execute сверяет план с approvedPlan — сохранить можно только одобренную версию, а не правленую.
export const savePlan = tool({
  name: "savePlan",
  description:
    "Сохраняет план, одобренный Safety Reviewer, в data/output.md (файл перезаписывается). " +
    "Доступен только после одобрения ревьюером. Передай план дословно, без единой правки: " +
    "сохраняется только одобренная версия, изменённый текст будет отклонён. Возвращает ok или описание ошибки.",
  parameters: z.object({
    markdown: z.string().describe("Полный текст одобренного плана в Markdown, дословно."),
  }),
  isEnabled: ({ runContext }: { runContext: RunContext<CoachContext> }) => Boolean(runContext.context.approvedPlan),
  execute: async ({ markdown }, runContext?: RunContext<CoachContext>) => {
    const approved = runContext?.context.approvedPlan;
    if (!approved) return "Ошибка: план ещё не одобрен Safety Reviewer, сохранять нельзя.";
    if (normalize(markdown) !== normalize(approved)) {
      return "Ошибка: текст отличается от одобренного плана. Передай одобренный план дословно, без правок.";
    }
    await writePlan(approved);
    runContext.context.saved = true;
    return "ok";
  },
});
