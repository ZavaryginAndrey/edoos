// Ингест базы знаний: knowledge/*.md → чанки по «##» → embeddings → Supabase (таблица knowledge_chunks).
// Запуск: npm run ingest. Идемпотентен: в одной транзакции очищает таблицу и заливает все чанки заново,
// поэтому повторный запуск не создаёт дублей, а удалённые из knowledge/ секции исчезают и из базы.
// Таблицу создаёт supabase/migrations/001_knowledge.sql — выполнить один раз до первого ингеста.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { chunkMarkdown, embeddingText } from "../src/rag/chunking";
import { closeDb, db } from "../src/rag/db";
import { embed, embeddingModel, toPgVector } from "../src/rag/embeddings";

const KNOWLEDGE_DIR = join(process.cwd(), "knowledge");

try {
  const files = (await readdir(KNOWLEDGE_DIR)).filter((file) => file.endsWith(".md")).sort();
  const chunks = (await Promise.all(
    files.map(async (file) => chunkMarkdown(file, await readFile(join(KNOWLEDGE_DIR, file), "utf8"))),
  )).flat();
  if (!chunks.length) throw new Error("В knowledge/*.md нет секций «## …».");

  // Дубли заголовков в одном файле запретил бы unique (file, heading) — ловим заранее с понятной ошибкой.
  const seen = new Set<string>();
  for (const { file, heading } of chunks) {
    const key = `${file} › ${heading}`;
    if (seen.has(key)) throw new Error(`Повторяющийся заголовок: ${key}`);
    seen.add(key);
  }

  console.log(`Чанков: ${chunks.length} из ${files.length} файлов. Embeddings: ${embeddingModel()}…`);
  // Сначала все embeddings, потом транзакция: ошибка API не оставит таблицу пустой.
  const vectors = await embed(chunks.map(embeddingText));
  const rows = chunks.map((chunk, index) => ({ ...chunk, embedding: toPgVector(vectors[index]) }));

  const sql = db();
  await sql.begin(async (tx) => {
    await tx`truncate knowledge_chunks restart identity`;
    await tx`insert into knowledge_chunks ${tx(rows, "file", "heading", "content", "embedding")}`;
  });

  const counts = await sql<{ file: string; chunks: number }[]>`
    select file, count(*)::int as chunks from knowledge_chunks group by file order by file
  `;
  for (const { file, chunks } of counts) console.log(`  ${file.padEnd(26)} ${chunks}`);
  console.log(`Готово: в knowledge_chunks ${counts.reduce((sum, row) => sum + row.chunks, 0)} строк.`);
} catch (error) {
  console.error("Ингест не удался:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
