import { splitIngredientInput } from "./ingredient-normalizer";
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
  const ungrounded = plan.recipes.filter((recipe) => !["gold", "howtocook", "deepseek"].includes(recipe.source.kind));
  return result(
    "check_source_grounding",
    ungrounded.length === 0,
    ungrounded.length
      ? `发现没有可信来源的菜谱：${ungrounded.map((recipe) => recipe.name).join("、")}。`
      : plan.recipes.every((recipe) => recipe.source.kind === "deepseek")
      ? `${plan.recipes.length} 道菜均保留 DeepSeek 生成来源，并将接受确定性约束复核。`
      : `${plan.recipes.length} 道菜均来自本地可信菜谱库。`,
    "hard",
  );
}

export function checkAllergens(plan: PlanOption, allergens: string) {
  const declared = splitIngredientInput(allergens);
  if (!declared.length) return result("check_allergens", true, "用户未声明过敏原。", "hard");

  const ingredientText = plan.recipes.flatMap((recipe) => [
    ...recipe.ingredients,
    ...recipe.steps.map((step) => step.instruction),
  ]).join("、");
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
  const completeInventory = plan.coverage.missing.length === 0 && plan.coverage.blockedSeasonings.length === 0 && plan.coverage.unused.length === 0;
  return result(
    "check_no_purchase",
    completeInventory,
    plan.coverage.blockedSeasonings.length
      ? `方案使用了你明确标记为没有的调料：${plan.coverage.blockedSeasonings.join("、")}。`
      : plan.coverage.missing.length
      ? `仍缺少主要食材：${plan.coverage.missing.join("、")}。`
      : plan.coverage.unused.length
      ? `方案没有用到全部现有食材：${plan.coverage.unused.join("、")}。单菜模式必须覆盖全部食材，多菜模式可拆分但仍需合计覆盖。`
      : "现有主要食材已全部纳入方案，无需新增购买。",
    "hard",
  );
}

export function checkSeasoningAssumptions(plan: PlanOption) {
  const seasonings = plan.coverage.specialtySeasonings;
  return result(
    "check_seasoning_assumptions",
    seasonings.length === 0,
    seasonings.length
      ? `这份菜谱还会用到特殊调料：${seasonings.join("、")}；已向用户明确提示。`
      : "仅使用默认中式家常基础调料。",
    "soft",
  );
}

export function checkTimeBudget(plan: PlanOption, maxMinutes: number) {
  const generated = plan.recipes.some((recipe) => recipe.source.kind === "deepseek");
  return result(
    "check_time_budget",
    plan.totalMinutes <= maxMinutes,
    plan.totalMinutes <= maxMinutes
      ? `预计 ${plan.totalMinutes} 分钟，符合 ${maxMinutes} 分钟预算。`
      : `真实做法约需 ${plan.totalMinutes} 分钟，超过 ${maxMinutes} 分钟；保留真实时长并提示。`,
    generated ? "hard" : "soft",
  );
}

export function checkMealCoherence(plan: PlanOption, input?: PlanInput) {
  const names = plan.recipes.map((recipe) => recipe.name);
  const expectedCount = input
    ? input.mode === "dish" || input.planScope === "single" ? 1 : input.dishCount
    : Math.min(2, names.length);
  const coherent = names.length === expectedCount && new Set(names).size === names.length;
  return result(
    "check_meal_coherence",
    coherent,
    coherent ? `方案由 ${names.join(" + ")} 组成，菜谱分别执行。` : `方案应包含 ${expectedCount} 道互不重复的菜。`,
    "hard",
  );
}

export function runPlanGuardrails(plan: PlanOption, input: PlanInput) {
  return [
    checkSourceGrounding(plan),
    checkAllergens(plan, input.allergens),
    checkNoPurchase(plan, input),
    checkSeasoningAssumptions(plan),
    checkTimeBudget(plan, input.maxMinutes),
    checkMealCoherence(plan, input),
  ];
}

export function hasHardFailure(results: GuardrailResult[]) {
  return results.some((item) => !item.passed && item.severity === "hard");
}
