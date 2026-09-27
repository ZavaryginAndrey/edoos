// Embeddings через OpenAI-compatible endpoint POST <base>/embeddings — обычный fetch, без SDK.
// У DeepSeek embeddings нет, поэтому провайдер отдельный: по умолчанию OpenAI text-embedding-3-small.

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "text-embedding-3-small";
// Должна совпадать с vector(1536) в supabase/migrations/001_knowledge.sql.
export const EMBEDDING_DIMENSIONS = 1536;
// Сколько текстов отправлять одним запросом: у OpenAI лимит 2048 входов, берём с запасом.
const BATCH_SIZE = 100;

export const embeddingModel = () => process.env.EMBEDDING_MODEL ?? DEFAULT_MODEL;

type EmbeddingsResponse = { data: { index: number; embedding: number[] }[] };

export async function embed(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) throw new Error("Добавь EMBEDDING_API_KEY в .env (ключ OpenAI-compatible провайдера embeddings).");
  const baseUrl = (process.env.EMBEDDING_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const input = texts.slice(start, start + BATCH_SIZE);
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: embeddingModel(), input }),
    });
    if (!response.ok) {
      throw new Error(`Embeddings API ответил ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const { data } = (await response.json()) as EmbeddingsResponse;
    // Порядок в ответе не гарантирован — сортируем по index.
    vectors.push(...[...data].sort((a, b) => a.index - b.index).map((item) => item.embedding));
  }

  const wrong = vectors.find((vector) => vector.length !== EMBEDDING_DIMENSIONS);
  if (wrong) {
    throw new Error(`Модель ${embeddingModel()} вернула вектор размерности ${wrong.length}, а таблица ждёт ${EMBEDDING_DIMENSIONS}.`);
  }
  return vectors;
}

// pgvector принимает вектор текстом «[0.1,0.2,…]» с приведением ::vector.
export const toPgVector = (vector: number[]) => `[${vector.join(",")}]`;
