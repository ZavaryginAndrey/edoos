import { tool } from "@openai/agents";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

// Next.js запускается из корня репозитория, поэтому данные ищем от cwd.
const PROFILE_PATH = join(process.cwd(), "data", "profile.md");

export const getProfile = tool({
  name: "getProfile",
  description:
    "Возвращает профиль пользователя (Markdown из data/profile.md): имя, возраст, рост и вес, работа и распорядок дня, " +
    "уровень активности, цели на ближайшие месяцы, ограничения по времени и инвентарю, пищевые предпочтения, " +
    "привычки по кофе и чаю, желаемый формат рекомендаций. " +
    "Вызывай в начале почти любой задачи о плане: без профиля нельзя подобрать калорийность, граммовки, время и нагрузку. " +
    "Параметров нет. Данные не меняются в течение запроса — одного вызова достаточно.",
  parameters: z.object({}),
  execute: () => readFile(PROFILE_PATH, "utf8"),
});
