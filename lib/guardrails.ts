import { analyzeInventoryCoverage } from "./inventory-composer";
import type { GuardrailResult, PlanInput, Recipe } from "./types";

const allergenAliases: Record<string, string[]> = {
  花生: ["花生", "花生酱", "花生油"],
  坚果: ["杏仁", "腰果", "核桃", "榛子", "开心果"],
  鸡蛋: ["鸡蛋", "蛋液", "蛋黄", "蛋白"],
  牛奶: ["牛奶", "奶油", "黄油", "芝士", "奶酪"],
  海鲜: ["虾", "蟹", "贝", "牡蛎", "鱿鱼", "鱼", "鲍鱼", "海参", "干贝", "鱼胶"],
  大豆: ["大豆", "豆腐", "豆浆", "酱油", "生抽", "老抽"],
  麸质: ["面粉", "面包", "面条", "馒头", "酱油"],
};

function splitTerms(value: string) {
  return value
    .split(/[，,、;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function validateCookingTime(recipe: Recipe, maxMinutes: number, allowOverrun = false): GuardrailResult {
  const passed = recipe.totalMinutes <= maxMinutes;
  return {
    tool: "validate_cooking_time",
    passed,
    severity: !passed && allowOverrun ? "soft" : "hard",
    detail: passed
      ? `预计 ${recipe.totalMinutes} 分钟，符合 ${maxMinutes} 分钟上限。`
      : allowOverrun
        ? `真实总时长约 ${recipe.totalMinutes} 分钟，超过 ${maxMinutes} 分钟；菜名查询保留原做法并提示，不伪造快手版。`
        : `预计 ${recipe.totalMinutes} 分钟，超过 ${maxMinutes} 分钟上限。`,
  };
}

export function checkAllergens(recipe: Recipe, allergens: string): GuardrailResult {
  const declared = splitTerms(allergens);
  if (declared.length === 0) {
    return {
      tool: "check_allergens",
      passed: true,
      severity: "hard",
      detail: "用户未声明过敏原。",
    };
  }

  const ingredientText = recipe.ingredients.join("、");
  const matches = declared.filter((allergen) => {
    const aliases = allergenAliases[allergen] ?? [allergen];
    return aliases.some((alias) => ingredientText.includes(alias));
  });

  return {
    tool: "check_allergens",
    passed: matches.length === 0,
    severity: "hard",
    detail:
      matches.length === 0
        ? `未发现与“${declared.join("、")}”匹配的食材。`
        : `发现潜在风险：${matches.join("、")}。方案已被拦截。`,
  };
}

export function checkRecipeComplexity(recipe: Recipe): GuardrailResult {
  const advance = recipe.advancePrepMinutes ?? 0;
  const complex = recipe.difficulty === "大师级" || recipe.difficulty === "困难" || recipe.totalMinutes > 120 || advance > 0;
  return {
    tool: "check_recipe_complexity",
    passed: !complex,
    severity: "soft",
    detail: complex
      ? `复杂菜保护已触发：${recipe.difficulty ?? "高难度"}，主动操作约 ${recipe.activeMinutes ?? recipe.totalMinutes} 分钟${advance ? `，另需提前 ${advance} 分钟` : ""}。`
      : `复杂度为${recipe.difficulty ?? "普通"}，无需跨日准备。`,
  };
}

export function validateInventory(recipe: Recipe, input?: PlanInput): GuardrailResult {
  if (!input || input.mode !== "ingredients" || !input.zeroPurchase) {
    return {
      tool: "validate_inventory",
      passed: true,
      severity: "hard",
      detail: "当前任务不启用零采购库存校验。",
    };
  }

  const coverage = analyzeInventoryCoverage(recipe, input);
  const passed = coverage.missing.length === 0 && coverage.unused.length === 0;
  return {
    tool: "validate_inventory",
    passed,
    severity: "hard",
    detail: passed
      ? `库存覆盖 ${coverage.used.length}/${coverage.used.length}，新增采购 0 项；基础调料：${coverage.pantryUsed.join("、") || "无"}。`
      : `零采购校验未通过：${coverage.missing.length ? `需新增 ${coverage.missing.join("、")}` : "无需新增食材"}${coverage.unused.length ? `；未使用 ${coverage.unused.join("、")}` : ""}。`,
  };
}

export function runGuardrails(
  recipe: Recipe,
  allergens: string,
  maxMinutes: number,
  allowTimeOverrun = false,
  input?: PlanInput,
) {
  return [
    validateCookingTime(recipe, maxMinutes, allowTimeOverrun),
    checkAllergens(recipe, allergens),
    checkRecipeComplexity(recipe),
    validateInventory(recipe, input),
  ];
}

export function hasHardFailure(results: GuardrailResult[]) {
  return results.some((result) => !result.passed && result.severity !== "soft");
}
