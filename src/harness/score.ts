import type { RoundState } from "./rounds";

export type ScoreSummary = { finalScore: number | null; improved: boolean };

// finalScore — оценка последнего одобренного раунда (null, если approve не было).
// improved — вырос ли score от первого раунда к последнему.
export function summarizeScore(rounds: RoundState[]): ScoreSummary {
  const approved = rounds.findLast((state) => state.review.verdict === "approve");
  const first = rounds[0];
  const last = rounds.at(-1);
  return {
    finalScore: approved?.review.score ?? null,
    improved: Boolean(first && last && last.round > first.round && last.review.score > first.review.score),
  };
}
