import { extractRecipeRequirements, ingredientMatches, splitIngredientInput } from "./ingredient-normalizer";
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

function coherentPair(left: Recipe, right: Recipe) {
  const leftRole = role(left);
  const rightRole = role(right);
  if (leftRole === "main" && rightRole === "main") return false;
  if (leftRole === "staple" && rightRole === "staple") return false;
  return left.technique !== right.technique || leftRole !== rightRole;
}

function estimatePlanTime(recipes: Recipe[]) {
  const activeMinutes = recipes.reduce((sum, recipe) => sum + recipe.activeMinutes, 0);
  const passiveMinutes = Math.max(...recipes.map((recipe) => Math.max(0, recipe.totalMinutes - recipe.activeMinutes)), 0);
  return { activeMinutes, totalMinutes: activeMinutes + passiveMinutes };
}

function buildCoverage(recipes: Recipe[], input: PlanInput): PantryCoverage {
  const available = splitIngredientInput(input.ingredients);
  const priority = splitIngredientInput(input.priorityIngredients);
  const pantry = splitIngredientInput(input.pantry);
  const required = unique(recipes.flatMap((recipe) =>
    extractRecipeRequirements(recipe.ingredients).filter((item) => !item.optional).map((item) => item.name),
  ));
  const used = available.filter((item) => required.some((requirement) => ingredientMatches(requirement, item)));
  const priorityUsed = priority.filter((item) => required.some((requirement) => ingredientMatches(requirement, item)));
  const pantryUsed = pantry.filter((item) => required.some((requirement) => ingredientMatches(requirement, item)));
  const missing = required.filter((requirement) =>
    !available.some((item) => ingredientMatches(requirement, item)) &&
    !pantry.some((item) => ingredientMatches(requirement, item)),
  );
  return {
    used: unique(used),
    unused: available.filter((item) => !used.includes(item)),
    priorityUsed: unique(priorityUsed),
    priorityUnused: priority.filter((item) => !priorityUsed.includes(item)),
    pantryUsed: unique(pantryUsed),
    missing: unique(missing),
    ratio: available.length ? used.length / available.length : 1,
  };
}

function toPlan(recipes: Recipe[], input: PlanInput, baseScore: number): PlanOption {
  const coverage = buildCoverage(recipes, input);
  const { activeMinutes, totalMinutes } = estimatePlanTime(recipes);
  const fitsTime = totalMinutes <= input.maxMinutes;
  const title = recipes.map((recipe) => recipe.name).join(" + ");
  const priorityTotal = coverage.priorityUsed.length + coverage.priorityUnused.length;
  const description = input.mode === "dish"
    ? "完整保留可信来源中的菜名、配方与操作顺序，不使用生成模板改写。"
    : recipes.length > 1
    ? `由 ${recipes.length} 道真实菜谱组成，分别烹饪，不把无关食材强行混成一道菜。`
    : "完整保留真实菜名、配方与操作顺序，不使用生成式模板造菜。";
  const score = baseScore + coverage.priorityUsed.length * 80 + coverage.used.length * 28 - coverage.unused.length * 4 - Math.max(0, totalMinutes - input.maxMinutes) * 2;
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
      : ["真实菜谱", "零新增食材", recipes.length > 1 ? "分开烹饪" : "单菜方案"],
    rationale: input.mode === "dish"
      ? `保留“${title}”的真实技法与耗时；时间预算只触发提示，不会篡改做法。`
      : priorityTotal
      ? `优先食材覆盖 ${coverage.priorityUsed.length}/${priorityTotal}；本次使用 ${coverage.used.length} 种现有食材，未使用的食材会明确保留。`
      : `本次使用 ${coverage.used.length} 种现有食材；未使用的库存不会被强行塞进菜里。`,
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
  const variants: PlanOption[] = cookable.map((match) => toPlan([match.recipe], input, match.score));

  if (input.planScope === "meal") {
    for (let left = 0; left < cookable.length; left += 1) {
      for (let right = left + 1; right < cookable.length; right += 1) {
        const first = cookable[left];
        const second = cookable[right];
        if (!coherentPair(first.recipe, second.recipe)) continue;
        variants.push(toPlan([first.recipe, second.recipe], input, first.score + second.score));
      }
    }
  }

  return variants
    .filter((plan) => plan.coverage.missing.length === 0)
    .sort((left, right) => {
      const leftPriority = left.coverage.priorityUsed.length - left.coverage.priorityUnused.length;
      const rightPriority = right.coverage.priorityUsed.length - right.coverage.priorityUnused.length;
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      if (left.fitsTime !== right.fitsTime) return left.fitsTime ? -1 : 1;
      if (left.coverage.used.length !== right.coverage.used.length) return right.coverage.used.length - left.coverage.used.length;
      return right.score - left.score;
    })
    .filter((plan, index, all) => all.findIndex((candidate) => candidate.title === plan.title) === index)
    .slice(0, limit);
}

export function buildDishPlans(recipes: Recipe[], input: PlanInput) {
  return recipes.map((recipe) => toPlan([recipe], input, recipe.confidence * 100));
}
