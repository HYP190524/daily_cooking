import { extractRecipeRequirements, ingredientMatches, splitIngredientInput } from "./ingredient-normalizer";
import { DEFAULT_PANTRY, seasoningKind } from "./pantry-presets";
import type { PantryCoverage, PlanInput, PlanOption, Recipe } from "./types";
import type { RecipeMatch } from "./pantry-ranker";

const proteinPattern = /鸡|鸭|鹅|猪|牛|羊|鱼|虾|蟹|贝|肉|排骨|蛋|豆腐/;
const staplePattern = /饭|面|粉|馒头|饼|粥|米线/;

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function unique(values: string[]) {
  return values.filter((value, index, all) => value && all.indexOf(value) === index);
}

function role(recipe: Recipe) {
  if (/汤|羹|粥/.test(recipe.name)) return "soup";
  if (staplePattern.test(recipe.name)) return "staple";
  const requirements = extractRecipeRequirements(recipe.ingredients).filter((item) => !item.optional);
  return requirements.some((item) => proteinPattern.test(item.name)) ? "main" : "side";
}

function coherentSet(recipes: Recipe[]) {
  const roles = recipes.map(role);
  if (new Set(recipes.map((recipe) => recipe.name)).size !== recipes.length) return false;
  if (roles.filter((item) => item === "main").length > Math.max(1, Math.ceil(recipes.length / 2))) return false;
  if (roles.filter((item) => item === "staple").length > 1) return false;
  if (recipes.length > 1 && new Set(roles).size === 1) return false;
  return recipes.length === 1 || new Set(recipes.map((recipe) => recipe.technique)).size > 1;
}

function combinations<T>(items: T[], count: number, start = 0, prefix: T[] = [], output: T[][] = []) {
  if (prefix.length === count) {
    output.push(prefix);
    return output;
  }
  for (let index = start; index <= items.length - (count - prefix.length); index += 1) {
    combinations(items, count, index + 1, [...prefix, items[index]], output);
  }
  return output;
}

function estimatePlanTime(recipes: Recipe[]) {
  const activeMinutes = recipes.reduce((sum, recipe) => sum + recipe.activeMinutes, 0);
  const passiveMinutes = Math.max(...recipes.map((recipe) => Math.max(0, recipe.totalMinutes - recipe.activeMinutes)), 0);
  return { activeMinutes, totalMinutes: activeMinutes + passiveMinutes };
}

function buildCoverage(recipes: Recipe[], input: PlanInput): PantryCoverage {
  const available = splitIngredientInput(input.ingredients);
  const unavailableSeasonings = splitIngredientInput(input.unavailableSeasonings);
  const required = unique(recipes.flatMap((recipe) =>
    extractRecipeRequirements(recipe.ingredients).filter((item) => !item.optional).map((item) => item.name),
  ));
  const used = available.filter((item) =>
    seasoningKind(item, unavailableSeasonings) === null && required.some((requirement) => ingredientMatches(requirement, item)),
  );
  const pantryUsed = DEFAULT_PANTRY.filter((item) =>
    required.some((requirement) => seasoningKind(requirement, unavailableSeasonings) === "default" && ingredientMatches(requirement, item)),
  );
  const specialtySeasonings = required.filter((requirement) =>
    seasoningKind(requirement, unavailableSeasonings) === "specialty",
  );
  const blockedSeasonings = required.filter((requirement) =>
    seasoningKind(requirement, unavailableSeasonings) === "blocked",
  );
  const missing = required.filter((requirement) =>
    !available.some((item) => ingredientMatches(requirement, item)) &&
    seasoningKind(requirement, unavailableSeasonings) === null,
  );
  return {
    used: unique(used),
    unused: available.filter((item) => seasoningKind(item, unavailableSeasonings) === null && !used.includes(item)),
    pantryUsed: unique(pantryUsed),
    specialtySeasonings: unique(specialtySeasonings),
    blockedSeasonings: unique(blockedSeasonings),
    missing: unique(missing),
    ratio: available.filter((item) => seasoningKind(item, unavailableSeasonings) === null).length
      ? used.length / available.filter((item) => seasoningKind(item, unavailableSeasonings) === null).length
      : 1,
  };
}

export function createPlanFromRecipes(recipes: Recipe[], input: PlanInput, baseScore: number): PlanOption {
  const coverage = buildCoverage(recipes, input);
  const { activeMinutes, totalMinutes } = estimatePlanTime(recipes);
  const fitsTime = totalMinutes <= input.maxMinutes;
  const title = recipes.map((recipe) => recipe.name).join(" + ");
  const partialInventory = input.mode === "ingredients" && coverage.unused.length > 0;
  const description = input.mode === "dish"
    ? "完整保留可信来源中的菜名、配方与操作顺序，不使用生成模板改写。"
    : partialInventory
    ? "没有找到一条菜谱覆盖全部库存，以下展示最接近的真实做法；未覆盖食材已明确列出。"
    : recipes.length > 1
    ? `由 ${recipes.length} 道真实菜谱组成，分别烹饪，不把无关食材强行混成一道菜。`
    : "完整保留真实菜名、配方与操作顺序，不使用生成式模板造菜。";
  const score = baseScore + coverage.used.length * 28 - coverage.unused.length * 80 - Math.max(0, totalMinutes - input.maxMinutes) * 2;
  return {
    id: uid("plan"),
    title,
    description,
    recipes,
    totalMinutes,
    activeMinutes,
    servings: input.servings,
    tags: input.mode === "dish"
      ? ["真实菜谱", "可信来源", "原始做法"]
      : ["真实菜谱", "零新增主食材", partialInventory ? "最接近方案" : recipes.length > 1 ? "分开烹饪" : "单菜方案"],
    rationale: input.mode === "dish"
      ? `保留“${title}”的真实技法与耗时；时间预算只触发提示，不会篡改做法。`
      : partialInventory
      ? `本次使用 ${coverage.used.length} 种主要食材；还剩 ${coverage.unused.join("、")}，建议切换多道菜。`
      : `本次方案覆盖 ${coverage.used.length} 种主要食材；默认调料按家庭常备处理。`,
    coverage,
    fitsTime,
    timeMessage: fitsTime
      ? `预计 ${totalMinutes} 分钟内完成。`
      : `真实完成约需 ${totalMinutes} 分钟，超过当前 ${input.maxMinutes} 分钟上限。`,
    score,
  };
}

export function buildIngredientPlans(matches: RecipeMatch[], input: PlanInput, limit = 2) {
  const cookable = matches.filter((match) => match.cookable).slice(0, 12);
  const variants: PlanOption[] = input.planScope === "single"
    ? cookable.map((match) => createPlanFromRecipes([match.recipe], input, match.score))
    : combinations(cookable, input.dishCount)
      .filter((set) => coherentSet(set.map((match) => match.recipe)))
      .map((set) => createPlanFromRecipes(set.map((match) => match.recipe), input, set.reduce((sum, match) => sum + match.score, 0)));

  return variants
    .filter((plan) => plan.coverage.missing.length === 0 && plan.coverage.blockedSeasonings.length === 0 && plan.coverage.unused.length === 0)
    .sort((left, right) => {
      if (left.fitsTime !== right.fitsTime) return left.fitsTime ? -1 : 1;
      if (left.coverage.used.length !== right.coverage.used.length) return right.coverage.used.length - left.coverage.used.length;
      return right.score - left.score;
    })
    .filter((plan, index, all) => all.findIndex((candidate) => candidate.title === plan.title) === index)
    .slice(0, limit);
}

/**
 * Returns honest nearest matches when a strict full-inventory plan is impossible.
 * The normal planner remains fail-closed; this path exists so the UI can
 * explain the trade-off instead of stopping with an empty workbench.
 */
export function buildClosestIngredientPlans(matches: RecipeMatch[], input: PlanInput, limit = 4) {
  const cookable = matches.filter((match) => match.cookable).slice(0, 12);
  const variants: PlanOption[] = input.planScope === "single"
    ? cookable.map((match) => createPlanFromRecipes([match.recipe], input, match.score))
    : combinations(cookable, input.dishCount)
      .filter((set) => coherentSet(set.map((match) => match.recipe)))
      .map((set) => createPlanFromRecipes(set.map((match) => match.recipe), input, set.reduce((sum, match) => sum + match.score, 0)));

  return variants
    .filter((plan) => plan.coverage.missing.length === 0 && plan.coverage.blockedSeasonings.length === 0)
    .sort((left, right) => {
      if (left.coverage.used.length !== right.coverage.used.length) return right.coverage.used.length - left.coverage.used.length;
      const leftProtein = left.coverage.used.filter((item) => /鸡|鸭|鹅|猪|牛|羊|鱼|虾|蟹|贝|肉|排骨|蛋|豆腐/.test(item)).length;
      const rightProtein = right.coverage.used.filter((item) => /鸡|鸭|鹅|猪|牛|羊|鱼|虾|蟹|贝|肉|排骨|蛋|豆腐/.test(item)).length;
      if (leftProtein !== rightProtein) return rightProtein - leftProtein;
      if (left.fitsTime !== right.fitsTime) return left.fitsTime ? -1 : 1;
      return right.score - left.score;
    })
    .filter((plan, index, all) => all.findIndex((candidate) => candidate.title === plan.title) === index)
    .slice(0, limit);
}

export function buildDishPlans(recipes: Recipe[], input: PlanInput) {
  return recipes.map((recipe) => createPlanFromRecipes([recipe], input, recipe.confidence * 100));
}
