import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import type { CoachContext } from "../agents/healthCoach";
import { searchKnowledge as search, type Retrieval } from "../rag/retriever";

// Retrieval из базы знаний (knowledge/*.md → Supabase pgvector) как обычный локальный tool коуча.
// Запрос и заголовки найденных чанков записываются в контекст запуска (retrievals): harness переносит их
// в результат и трейс, UI показывает «🔍 knowledge: <запрос> → N chunks».
export const searchKnowledge = tool({
  name: "searchKnowledge",
  description:
    "Ищи в базе знаний рецепты, правила питания, шаблоны тренировок, правила восстановления, а также правила " +
    "учёта предпочтений (без молочки, вегетарианство, мало времени на готовку и т. п.). Возвращает до 5 самых " +
    "близких по смыслу секций с источником (файл › заголовок) и близостью 0–1. Вызывай до того, как писать " +
    "питание, тренировки или восстановление, и опирайся на найденное вместо знаний из головы. " +
    "Под разные темы делай отдельные запросы.",
  parameters: z.object({
    query: z
      .string()
      .min(2)
      .describe("Запрос по-русски, конкретно и по смыслу: «ужин с высоким белком без молочки», «восстановление после интервалов»."),
  }),
  execute: async ({ query }, runContext?: RunContext<CoachContext>) => {
    const retrieval: Retrieval = { query, chunks: [] };
    // Запись добавляется до await: при параллельных вызовах порядок retrievals совпадает с порядком вызовов.
    runContext?.context.retrievals?.push(retrieval);
    try {
      const chunks = await search(query);
      retrieval.chunks = chunks.map(({ file, heading, similarity }) => ({ file, heading, similarity }));
      console.log(`🔍 knowledge: «${query}» → ${chunks.length} chunks: ${chunks.map((c) => `${c.file} › ${c.heading}`).join("; ")}`);
      if (!chunks.length) return "База знаний пуста: ничего не найдено. Не выдумывай рецепты — используй любимые рецепты пользователя.";
      return chunks
        .map((chunk) => `### ${chunk.file} › ${chunk.heading} (близость ${chunk.similarity.toFixed(2)})\n${chunk.content}`)
        .join("\n\n");
    } catch (error) {
      // Недоступная база знаний не должна ронять запуск: модель получает ошибку текстом, как от выключенного MCP.
      retrieval.error = error instanceof Error ? error.message : String(error);
      console.error(`searchKnowledge: ${retrieval.error}`);
      return `База знаний недоступна (${retrieval.error}). Не выдумывай рецепты — используй любимые рецепты пользователя и напиши в плане, что база знаний не проверена.`;
    }
  },
});
