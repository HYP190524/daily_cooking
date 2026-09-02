import { ingredientMatches, splitIngredientInput } from "./ingredient-normalizer";
import type { GuardrailResult, PlanInput, PlanOption } from "./types";

const allergenAliases: Record<string, string[]> = {
  花生: ["花生", "花生酱", "花生油"],
  坚果: ["杏仁", "腰果", "核桃", "榛子", "开心果"],
  鸡蛋: ["鸡蛋", "蛋液", "蛋黄", "蛋白"],
  牛奶: ["牛奶", "奶油", "黄油", "芝士", "奶酪"],
  海鲜: ["虾", "蟹", "贝", "牡蛎", "鱿鱼", "鱼", "鲍鱼", "海参", "干贝", "鱼胶"],
  大豆: ["大豆", "豆腐", "豆浆", "酱油", "生抽", "老抽"],
  麸质: ["面粉", "面包", "面条", "馒头", "酱油"],
};

function result(
  tool: GuardrailResult["tool"],
  passed: boolean,
  detail: string,
  severity: GuardrailResult["severity"],
): GuardrailResult {
  return { tool, passed, detail, severity };
}

export function checkSourceGrounding(plan: PlanOption) {
  const ungrounded = plan.recipes.filter((recipe) => !["gold", "howtocook"].includes(recipe.source.kind));
  return result(
    "check_source_grounding",
    ungrounded.length === 0,
    ungrounded.length
      ? `发现没有可信来源的菜谱：${ungrounded.map((recipe) => recipe.name).join("、")}。`
      : `${plan.recipes.length} 道菜均来自本地可信菜谱库。`,
    "hard",
  );
}

export function checkAllergens(plan: PlanOption, allergens: string) {
  const declared = splitIngredientInput(allergens);
  if (!declared.length) return result("check_allergens", true, "用户未声明过敏原。", "hard");

  const ingredientText = plan.recipes.flatMap((recipe) => recipe.ingredients).join("、");
  const matches = declared.filter((allergen) =>
    (allergenAliases[allergen] ?? [allergen]).some((alias) => ingredientText.includes(alias)),
  );
  return result(
    "check_allergens",
    matches.length === 0,
    matches.length ? `发现潜在过敏风险：${matches.join("、")}。` : `未发现“${declared.join("、")}”相关食材。`,
    "hard",
  );
}

export function checkNoPurchase(plan: PlanOption, input: PlanInput) {
  if (input.mode === "dish") {
    return result("check_no_purchase", true, "菜名查询模式展示原始配方，不启用库存闭包。", "hard");
  }
  return result(
    "check_no_purchase",
    plan.coverage.missing.length === 0,
    plan.coverage.missing.length
      ? `仍需购买：${plan.coverage.missing.join("、")}。`
      : "库存闭包通过：只使用现有食材和已声明基础调料，新增采购 0 项。",
    "hard",
  );
}

export function checkTimeBudget(plan: PlanOption, maxMinutes: number) {
  return result(
    "check_time_budget",
    plan.totalMinutes <= maxMinutes,
    plan.totalMinutes <= maxMinutes
      ? `预计 ${plan.totalMinutes} 分钟，符合 ${maxMinutes} 分钟预算。`
      : `真实做法约需 ${plan.totalMinutes} 分钟，超过 ${maxMinutes} 分钟；保留真实时长并提示。`,
    "soft",
  );
}

export function checkPriorityCoverage(plan: PlanOption, input: PlanInput) {
  const priority = splitIngredientInput(input.priorityIngredients);
  if (!priority.length) return result("check_priority_coverage", true, "未设置优先消耗食材。", "soft");
  const uncovered = priority.filter((item) => !plan.coverage.priorityUsed.some((used) => ingredientMatches(item, used)));
  return result(
    "check_priority_coverage",
    uncovered.length === 0,
    uncovered.length
      ? `这顿暂不使用：${uncovered.join("、")}；它们不会被强行拼进不真实的菜。`
      : `已覆盖全部 ${priority.length} 种优先消耗食材。`,
    "soft",
  );
}

export function checkMealCoherence(plan: PlanOption) {
  const names = plan.recipes.map((recipe) => recipe.name);
  const coherent = names.length >= 1 && names.length <= 2 && new Set(names).size === names.length;
  return result(
    "check_meal_coherence",
    coherent,
    coherent ? `方案由 ${names.join(" + ")} 组成，菜谱分别执行。` : "一餐组合含重复菜或超过两道菜。",
    "hard",
  );
}

export function runPlanGuardrails(plan: PlanOption, input: PlanInput) {
  return [
    checkSourceGrounding(plan),
    checkAllergens(plan, input.allergens),
    checkNoPurchase(plan, input),
    checkTimeBudget(plan, input.maxMinutes),
    checkPriorityCoverage(plan, input),
    checkMealCoherence(plan),
  ];
}

export function hasHardFailure(results: GuardrailResult[]) {
  return results.some((item) => !item.passed && item.severity === "hard");
}
