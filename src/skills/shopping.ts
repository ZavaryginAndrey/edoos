import { tool } from "@openai/agents";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const SHOPPING_PATH = join(process.cwd(), "data", "shopping.md");

// Продукты ищем по словарю основ слов — без LLM, чтобы список был детерминированным и проверяемым.
// Порядок категорий = порядок разделов в списке покупок.
const CATALOG: Record<string, [name: string, stem: string][]> = {
  "Мясо, птица, рыба": [
    ["Курица", "кур(?:ин|иц)"], ["Индейка", "индейк|индюш"], ["Говядина", "говядин"], ["Свинина", "свинин"],
    ["Фарш", "фарш"], ["Лосось", "лосос|сёмг|семг"], ["Тунец", "тун(?:ец|ц)"], ["Треска", "треск"],
    ["Креветки", "креветк"],
  ],
  "Яйца и молочное": [
    ["Яйца", "яйц|яиц|яйко"], ["Творог", "твор(?:ог|ож)"], ["Греческий йогурт", "греческ\\S* йогурт"],
    ["Йогурт", "(?<!греческ\\S* )йогурт"], ["Кефир", "кефир"], ["Молоко", "молок"], ["Сметана", "сметан"],
    ["Сыр", "сыр(?:а|ом|у)?(?![а-яё])"], ["Сливочное масло", "сливочн\\S* масл"],
  ],
  "Крупы, хлеб, гарниры": [
    ["Гречка", "гречк|гречн"], ["Рис", "рис(?:а|ом|у)?(?![а-яё])"], ["Овсяные хлопья", "овсян|овсянк"],
    ["Булгур", "булгур"], ["Киноа", "киноа"], ["Макароны", "макарон|спагетти"],
    ["Цельнозерновой хлеб", "(?:цельнозернов|ржан)\\S* (?:хлеб|тост)"], ["Хлеб", "(?<!(?:цельнозернов|ржан)\\S* )(?:хлеб|тост)"],
    ["Лаваш", "лаваш"], ["Картофель", "картоф"],
  ],
  "Овощи и зелень": [
    ["Огурцы", "огур(?:ец|ц)"], ["Помидоры", "помидор|томат(?!н)|черри"], ["Болгарский перец", "перец|перц"],
    ["Брокколи", "брокколи"], ["Капуста", "капуст"], ["Морковь", "морков"], ["Кабачки", "кабач"],
    ["Шпинат", "шпинат"], ["Свёкла", "св[её]кл"], ["Авокадо", "авокадо"], ["Лук", "лук(?:а|ом)?(?![а-яё])"],
    ["Чеснок", "чеснок"], ["Зелень", "зелен(?!\\S* чай)"],
  ],
  "Фрукты и ягоды": [
    ["Бананы", "банан"], ["Яблоки", "яблок"], ["Груши", "груш"], ["Апельсины", "апельсин"],
    ["Мандарины", "мандарин"], ["Киви", "киви"], ["Ягоды", "ягод|черник|клубник|малин"],
  ],
  "Прочее": [
    ["Орехи", "орех|миндал|кешью"], ["Оливковое масло", "оливков\\S* масл"], ["Мёд", "м[её]д(?:а|ом)?(?![а-яё])"],
    ["Хумус", "хумус"], ["Арахисовая паста", "арахисов\\S* паст"],
  ],
};

const UNITS: Record<string, [unit: string, factor: number]> = {
  г: ["г", 1], гр: ["г", 1], кг: ["г", 1000], мл: ["мл", 1], л: ["мл", 1000], шт: ["шт", 1],
};
const NUMBER = "(\\d+(?:[.,]\\d+)?)";
// «гречка 180 г», «творог — 200 г», «лосось (150 г)», «куриное филе 180 г», «творог 5 % 200 г»
const AMOUNT_AFTER = new RegExp(
  `^[а-яё]*(?:\\s+[а-яё]+)?\\s*[-—–:(]?\\s*(?:\\d+(?:[.,]\\d+)?\\s*%\\s*)?${NUMBER}\\s*(кг|гр|г|мл|л|шт)\\.?(?![а-яё])`, "i",
);
// «150 г лосося», «омлет из 3 яиц», «2 шт. банана»
const AMOUNT_BEFORE = new RegExp(`${NUMBER}\\s*(кг|гр|г|мл|л|шт)?\\.?\\s*$`, "i");

type Totals = Map<string, Map<string, number>>;

// Если в плане есть раздел «## Питание», берём только его: в остальных разделах продукты
// упоминаются как запреты («без чипсов») или отслеживание, а не как покупки.
function nutritionSection(markdown: string): string {
  const text = markdown.replace(/\r\n/g, "\n");
  const match = text.match(/^##[^\S\n]*Питание[^\n]*\n([\s\S]*?)(?=^##[^#]|$(?![\s\S]))/im);
  return match ? match[1] : text;
}

function extractProducts(markdown: string): Map<string, Totals> {
  const text = nutritionSection(markdown).toLocaleLowerCase("ru-RU");
  const result = new Map<string, Totals>();

  for (const [category, products] of Object.entries(CATALOG)) {
    const totals: Totals = new Map();
    for (const [name, stem] of products) {
      const pattern = new RegExp(`(?<![а-яё])(?:${stem})`, "g");
      for (const match of text.matchAll(pattern)) {
        const amounts = totals.get(name) ?? new Map<string, number>();
        totals.set(name, amounts);
        const start = match.index;
        const after = text.slice(start + match[0].length, start + match[0].length + 40).match(AMOUNT_AFTER);
        const before = after ? null : text.slice(Math.max(0, start - 12), start).match(AMOUNT_BEFORE);
        const found = after ?? before;
        if (!found) continue;
        const [unit, factor] = UNITS[(found[2] ?? "шт").toLowerCase()];
        amounts.set(unit, (amounts.get(unit) ?? 0) + Number(found[1].replace(",", ".")) * factor);
      }
    }
    if (totals.size) result.set(category, totals);
  }
  return result;
}

const formatAmounts = (amounts: Map<string, number>) =>
  [...amounts].map(([unit, value]) =>
    unit !== "шт" && value >= 1000 ? `${+(value / 1000).toFixed(2)} ${unit === "г" ? "кг" : "л"}` : `${+value.toFixed(1)} ${unit}`,
  ).join(" + ");

async function writeShoppingList(planMarkdown: string): Promise<string> {
  const products = extractProducts(planMarkdown);
  if (!products.size) {
    return "В плане не нашлось продуктов: data/shopping.md не изменён. Добавь в план питания конкретные продукты с граммовками и вызови tool снова.";
  }
  const sections = [...products].map(([category, totals]) =>
    [`## ${category}`, ...[...totals].map(([name, amounts]) => `- ${name}${amounts.size ? ` — ${formatAmounts(amounts)}` : ""}`)].join("\n"),
  );
  const list = [
    "# Список покупок",
    "Собран автоматически из плана питания: количества — сумма граммовок, упомянутых в плане.",
    ...sections,
  ].join("\n\n");
  await writeFile(SHOPPING_PATH, `${list}\n`, "utf8");
  return `Список сохранён в data/shopping.md:\n\n${list}`;
}

export const generateShoppingList = tool({
  name: "generateShoppingList",
  description:
    "Составляет список покупок по готовому плану питания и сохраняет его в data/shopping.md (файл перезаписывается). " +
    "Продукты извлекаются из раздела «## Питание» (или из всего текста, если такого раздела нет) по словарю, " +
    "количества в граммах, миллилитрах и штуках суммируются так, как они написаны в плане. " +
    "Вызывай только когда пользователь просит список покупок или продуктов, и только после того, как план питания " +
    "составлен: передай его полный Markdown. Возвращает получившийся список — не пересказывай его в плане целиком.",
  parameters: z.object({
    planMarkdown: z
      .string()
      .describe("Полный текст плана в Markdown с блюдами и граммовками, например «гречка 180 г, индейка 150 г»."),
  }),
  execute: ({ planMarkdown }) => writeShoppingList(planMarkdown),
});
