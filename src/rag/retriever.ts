import { db } from "./db";
import { embed, toPgVector } from "./embeddings";

// Простой RAG: один embedding запроса и один similarity search в pgvector. Без reranking, hybrid search
// и переписывания запроса — модель получает ровно то, что нашла косинусная близость.

export const DEFAULT_TOP_K = 5;

export type KnowledgeChunk = { file: string; heading: string; content: string; similarity: number };

// Что попадает в трейс и UI: запрос и заголовки найденных чанков (без текста — он есть в knowledge/).
export type Retrieval = {
  query: string;
  chunks: { file: string; heading: string; similarity: number }[];
  error?: string;
};

export async function searchKnowledge(query: string, topK = DEFAULT_TOP_K): Promise<KnowledgeChunk[]> {
  const [vector] = await embed([query]);
  const embedding = toPgVector(vector);
  // <=> — косинусное расстояние pgvector (индекс hnsw vector_cosine_ops), similarity = 1 − расстояние.
  const rows = await db()<KnowledgeChunk[]>`
    select file, heading, content, 1 - (embedding <=> ${embedding}::vector) as similarity
    from knowledge_chunks
    order by embedding <=> ${embedding}::vector
    limit ${topK}
  `;
  return rows.map((row) => ({ ...row, similarity: Number(row.similarity) }));
}
