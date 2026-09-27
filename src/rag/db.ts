import postgres from "postgres";

// Прямое подключение к Postgres в Supabase (Dashboard → Connect → connection string). Только SQL, без supabase-js.
let client: postgres.Sql | undefined;

export function db(): postgres.Sql {
  if (client) return client;
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("Добавь SUPABASE_DB_URL в .env (connection string Postgres из Supabase).");
  client = postgres(url, {
    // Supabase pooler в режиме transaction не поддерживает prepared statements.
    prepare: false,
    // Облачный Supabase требует TLS; локальный (supabase start) работает без него.
    ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : "require",
    max: 3,
    // Простаивающее соединение закрывается, иначе CLI-скрипты (npm run eval) не завершаются сразу.
    idle_timeout: 5,
  });
  return client;
}

export async function closeDb() {
  await client?.end();
  client = undefined;
}
