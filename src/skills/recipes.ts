import { tool } from "@openai/agents";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const RECIPES_PATH = join(process.cwd(), "data", "recipes.md");

export const listFavoriteRecipes = tool({
  name: "listFavoriteRecipes",
  description:
    "Возвращает любимые рецепты пользователя (Markdown из data/recipes.md): название, приём пищи, время приготовления, " +
    "ингредиенты с граммовками, примерные КБЖУ на порцию и короткие шаги. " +
    "Вызывай, когда составляешь план питания или меню: опирайся на эти блюда вместо придуманных, " +
    "подгоняя граммовки под цель. Особенно полезно для завтрака — у пользователя на него около 15 минут. " +
    "Параметров нет.",
  parameters: z.object({}),
  execute: () => readFile(RECIPES_PATH, "utf8"),
});
