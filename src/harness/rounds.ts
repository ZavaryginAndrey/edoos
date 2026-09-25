import type { Review } from "./validateReview";

export type RoundState = { round: number; plan: string; review: Review };

// История раундов одного запуска: только добавление, номера идут по порядку с 1.
export class RoundHistory {
  private readonly states: RoundState[] = [];

  record(plan: string, review: Review): RoundState {
    const state = { round: this.states.length + 1, plan, review };
    this.states.push(state);
    return state;
  }

  get last(): RoundState | undefined {
    return this.states.at(-1);
  }

  toArray(): RoundState[] {
    return [...this.states];
  }
}

export const formatRound = ({ round, review }: RoundState) =>
  `Раунд ${round}: verdict=${review.verdict}, score=${review.score}, issues=${
    review.issues.length ? review.issues.join("; ") : "нет"
  }`;
