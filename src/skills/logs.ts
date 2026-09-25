import { tool } from "@openai/agents";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const LOG_PATH = join(process.cwd(), "data", "log.md");
const MAX_DAYS = 14;

// Дневник — Markdown, где каждый день начинается с «## <дата>», записи идут от старых к новым.
// «Последние N дней» — это последние N таких записей: даты в файле без года, считать от сегодняшнего дня нельзя.
async function readRecentLog(days: number): Promise<string> {
  const text = (await readFile(LOG_PATH, "utf8")).replace(/\r\n/g, "\n");
  const [, ...entries] = text.split(/^(?=## )/m);
  if (!entries.length) return "Дневник пуст: записей по дням нет.";
  const recent = entries.slice(-days).map((entry) => entry.trim());
  const note = recent.length < days ? `В дневнике только ${recent.length} дн. — возвращаю все.\n\n` : "";
  return `${note}${recent.join("\n\n")}`;
}

export const getRecentLog = tool({
  name: "getRecentLog",
  description:
    "Возвращает последние записи дневника пользователя (data/log.md), по одной на день, от старых к новым: " +
    "время отбоя и подъёма, приёмы пищи со временем и граммовками, тренировки, шаги, вода, самочувствие. " +
    "Вызывай, когда план должен учитывать фактическое поведение: запрос «с учётом лога/дневника», план питания, " +
    "сон и режим, корректировка нагрузки. Для плана на день обычно хватает 3 дней, для плана на неделю — 7. " +
    "Если записей меньше, чем запрошено, вернутся все имеющиеся.",
  parameters: z.object({
    days: z.number().int().min(1).max(MAX_DAYS).describe(`Сколько последних дней дневника вернуть, от 1 до ${MAX_DAYS}.`),
  }),
  execute: ({ days }) => readRecentLog(days),
});
