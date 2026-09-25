import { Agent } from "@openai/agents";
import { getRecentLog } from "../skills/logs";
import { generateShoppingList } from "../skills/shopping";
import { savePlan, type CoachContext } from "../skills/plans";
import { getProfile } from "../skills/profile";
import { listFavoriteRecipes } from "../skills/recipes";
import { suggestWorkoutTemplate } from "../skills/workouts";

export type { CoachContext };

// Tools есть только у коуча: он сам решает, какие данные ему нужны. savePlan скрыт до approve (см. src/skills/plans.ts).
const COACH_TOOLS = [getProfile, getRecentLog, listFavoriteRecipes, suggestWorkoutTemplate, generateShoppingList, savePlan];

// Текст промпта — prompts/healthCoach.<версия>.md, загружается через src/harness/promptVersions.ts.
export const createHealthCoach = (model: string, instructions: string) =>
  new Agent<CoachContext>({ name: "Health Coach Agent", instructions, model, tools: COACH_TOOLS });
