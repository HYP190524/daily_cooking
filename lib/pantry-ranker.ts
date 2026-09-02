import {
  extractRecipeRequirements,
  findMatchingIngredient,
  ingredientMatches,
  splitIngredientInput,
} from "./ingredient-normalizer";
import type { PlanInput, Recipe } from "./types";

export interface RecipeMatch {
  recipe: Recipe;
  required: string[];
  matched: string[];
  availableUsed: string[];
  priorityUsed: string[];
  pantryUsed: string[];
  missing: string[];
  matchPercent: number;
  score: number;
  cookable: boolean;
}

function unique(values: string[]) {
  return values.filter((value, index, all) => value && all.indexOf(value) === index);
}

function preferenceBoost(recipe: Recipe, taste: string) {
  if (!taste.trim()) return 0;
  const text = `${recipe.name} ${recipe.description} ${recipe.tags.join(" ")}`;
  const terms = taste.split(/[，,、;；\s]+/).filter(Boolean);
  return terms.filter((term) => text.includes(term)).length * 4;
}

export function rankPantryRecipes(recipes: Recipe[], input: PlanInput) {
  const available = splitIngredientInput(input.ingredients);
  const priority = splitIngredientInput(input.priorityIngredients);
  const pantry = splitIngredientInput(input.pantry);

  return recipes
    .map<RecipeMatch>((recipe) => {
      const requirements = extractRecipeRequirements(recipe.ingredients).filter((item) => !item.optional);
      const required = requirements.map((item) => item.name);
      const availableUsed = unique(available.filter((item) => required.some((requirement) => ingredientMatches(requirement, item))));
      const priorityUsed = unique(priority.filter((item) => required.some((requirement) => ingredientMatches(requirement, item))));
      const pantryUsed = unique(pantry.filter((item) => required.some((requirement) => ingredientMatches(requirement, item))));
      const missing = unique(required.filter((requirement) =>
        !findMatchingIngredient(requirement, available) && !findMatchingIngredient(requirement, pantry),
      ));
      const matched = unique([...availableUsed, ...priorityUsed, ...pantryUsed]);
      const matchPercent = required.length ? Math.round(((required.length - missing.length) / required.length) * 100) : 0;
      const timePenalty = Math.max(0, recipe.totalMinutes - input.maxMinutes) * 1.5;
      const sourceBoost = recipe.source.kind === "gold" ? 22 : 8;
      const score =
        priorityUsed.length * 70 +
        availableUsed.length * 24 +
        matchPercent * 0.7 +
        sourceBoost +
        preferenceBoost(recipe, input.taste) -
        missing.length * 90 -
        timePenalty;
      return {
        recipe,
        required,
        matched,
        availableUsed,
        priorityUsed,
        pantryUsed,
        missing,
        matchPercent,
        score,
        cookable: missing.length === 0 && availableUsed.length > 0,
      };
    })
    .filter((match) => match.availableUsed.length > 0 || match.priorityUsed.length > 0)
    .sort((left, right) => right.score - left.score || right.recipe.confidence - left.recipe.confidence);
}

export function summarizeNearest(matches: RecipeMatch[], limit = 3) {
  return matches
    .filter((match) => !match.cookable)
    .sort((left, right) => left.missing.length - right.missing.length || right.score - left.score)
    .slice(0, limit)
    .map((match) => `${match.recipe.name}（缺 ${match.missing.join("、")}）`);
}
