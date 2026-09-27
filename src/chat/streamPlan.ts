import type { ChatWriter } from "./timeline";

// План приходит из harness целиком — уже после ревью, поэтому непроверенный текст в чат не попадает.
// В чат он выдаётся небольшими дельтами, как поток токенов.
const WORDS_PER_DELTA = 3;
const DELTA_DELAY_MS = 15;
const PLAN_TEXT_ID = "plan";

// Кусочки по несколько слов вместе с пробелами и переводами строк после них: склейка дельт равна плану.
export function planDeltas(plan: string): string[] {
  const leading = /^\s*/.exec(plan)?.[0] ?? "";
  const words = plan.slice(leading.length).match(/\S+\s*/g) ?? [];
  const deltas: string[] = [];
  for (let index = 0; index < words.length; index += WORDS_PER_DELTA) {
    deltas.push(words.slice(index, index + WORDS_PER_DELTA).join(""));
  }
  if (leading) deltas.unshift(leading);
  return deltas;
}

// Если клиент ушёл, проигрывание прекращается: писать больше некому.
export async function streamPlan(writer: ChatWriter, plan: string, signal: AbortSignal) {
  writer.write({ type: "text-start", id: PLAN_TEXT_ID });
  for (const delta of planDeltas(plan)) {
    if (signal.aborted) return;
    writer.write({ type: "text-delta", id: PLAN_TEXT_ID, delta });
    await new Promise((resolve) => setTimeout(resolve, DELTA_DELAY_MS));
  }
  writer.write({ type: "text-end", id: PLAN_TEXT_ID });
}
