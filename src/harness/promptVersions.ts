import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Как и data/, промпты ищем от cwd: Next.js запускается из корня репозитория.
const PROMPTS_DIR = join(process.cwd(), "prompts");

// Активные версии: prompts/<файл>.<версия>.md. Новая версия — новый файл и правка только этой константы.
export const ACTIVE_PROMPTS = { coach: "v2", reviewer: "v2" };
export type PromptVersions = typeof ACTIVE_PROMPTS;

const PROMPT_FILES: Record<keyof PromptVersions, string> = { coach: "healthCoach", reviewer: "safetyReviewer" };

export async function loadPrompt(name: string, version: string): Promise<string> {
  // Без разделителей пути: имя и версия не должны выводить за пределы prompts/.
  if (!/^[\w.-]+$/.test(name) || !/^[\w.-]+$/.test(version)) {
    throw new Error(`Некорректное имя или версия промпта: ${name}.${version}`);
  }
  const file = `${name}.${version}.md`;
  const text = await readFile(join(PROMPTS_DIR, file), "utf8").catch(() => {
    throw new Error(`Промпт prompts/${file} не найден.`);
  });
  return text.replace(/\r\n/g, "\n").trim();
}

export async function loadPrompts(versions: PromptVersions): Promise<Record<keyof PromptVersions, string>> {
  const [coach, reviewer] = await Promise.all([
    loadPrompt(PROMPT_FILES.coach, versions.coach), loadPrompt(PROMPT_FILES.reviewer, versions.reviewer),
  ]);
  return { coach, reviewer };
}
