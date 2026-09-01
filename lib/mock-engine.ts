import type { PlanInput, Recipe, ReplanInput, TraceEvent } from "./types";
import { composeInventoryRecipes } from "./inventory-composer";
import { searchLocalRecipes } from "./recipe-index";

function id(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function trace(
  kind: TraceEvent["kind"],
  label: string,
  detail: string,
  status: TraceEvent["status"] = "success",
  durationMs?: number,
): TraceEvent {
  return {
    id: id("trace"),
    kind,
    label,
    detail,
    status,
    durationMs,
    createdAt: new Date().toISOString(),
  };
}

function parseIngredients(raw: string) {
  return raw
    .split(/[，,、;；\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function hasAny(items: string[], terms: string[]) {
  return terms.some((term) => items.some((item) => item.includes(term)));
}

function buildPrimaryRecipe(input: PlanInput, ingredients: string[]): Recipe {
  const protein = ingredients.find((item) => /鸡|牛|猪|鱼|虾|豆腐|蛋/.test(item)) ?? ingredients[0] ?? "豆腐";
  const vegetables = ingredients.filter((item) => item !== protein).slice(0, 3);
  const sides = vegetables.length ? vegetables.join("、") : "时蔬";

  return {
    id: id("recipe"),
    name: `${protein}${sides === "时蔬" ? "时蔬" : "杂蔬"}一锅焖`,
    description: "少洗锅、步骤短，先处理最费时的食材，再用同一口锅完成。",
    totalMinutes: Math.min(input.maxMinutes, 26),
    servings: input.servings,
    ingredients: [...ingredients, "食用油", "盐"].slice(0, 10),
    tags: [input.taste || "家常", "一锅完成", "低清洁成本"],
    rationale: `优先消耗 ${protein} 与 ${sides}，把准备和加热交叠，留出约 4 分钟容错。`,
    steps: [
      {
        id: id("step"),
        title: "处理食材",
        instruction: `将 ${protein} 切成易熟的小块；${sides} 清洗并切好。`,
        minutes: 6,
      },
      {
        id: id("step"),
        title: "先煎主料",
        instruction: `锅中放少量油，中火将 ${protein} 煎至表面变色。`,
        minutes: 6,
      },
      {
        id: id("step"),
        title: "加入配菜",
        instruction: `加入 ${sides} 翻炒，沿锅边加入少量水并加盖。`,
        minutes: 8,
      },
      {
        id: id("step"),
        title: "调味收尾",
        instruction: `开盖检查熟度，按“${input.taste || "家常"}”偏好调味并收汁。`,
        minutes: 4,
      },
    ],
  };
}

function buildSecondaryRecipe(input: PlanInput, ingredients: string[]): Recipe {
  const main = ingredients.slice(0, 4);
  const hasEgg = hasAny(ingredients, ["鸡蛋", "蛋"]);
  const base = hasEgg ? "鸡蛋" : hasAny(ingredients, ["豆腐"]) ? "豆腐" : main[0] ?? "时蔬";
  const other = main.filter((item) => item !== base).join("、") || "现有蔬菜";

  return {
    id: id("recipe"),
    name: `${base}${other === "现有蔬菜" ? "时蔬" : "彩蔬"}快炒`,
    description: "利用高温快炒缩短时间，适合希望口感清爽、随时可以替换食材的场景。",
    totalMinutes: Math.min(input.maxMinutes, 22),
    servings: input.servings,
    ingredients: [...ingredients, "食用油", "盐"].slice(0, 10),
    tags: [input.taste || "清爽", "快速", "可替换"],
    rationale: `以 ${base} 建立主体口感，${other} 补充颜色和层次，整体只需要一次集中备料。`,
    steps: [
      {
        id: id("step"),
        title: "集中备料",
        instruction: `把 ${main.join("、") || "现有食材"} 切成大小接近的块或片。`,
        minutes: 7,
      },
      {
        id: id("step"),
        title: `炒香 ${base}`,
        instruction: `热锅放油，先将 ${base} 炒至表面有轻微焦香。`,
        minutes: 5,
      },
      {
        id: id("step"),
        title: "大火快炒",
        instruction: `加入 ${other}，保持大火翻炒至断生。`,
        minutes: 6,
      },
      {
        id: id("step"),
        title: "尝味出锅",
        instruction: `加盐并根据“${input.taste || "清爽"}”偏好调整味道，立即出锅。`,
        minutes: 2,
      },
    ],
  };
}

export function createMockPlan(input: PlanInput): Recipe[] {
  const local = searchLocalRecipes(input, input.mode === "ingredients" ? { limit: 6, diversify: false } : undefined);
  if (input.mode === "ingredients" && input.zeroPurchase) {
    return composeInventoryRecipes(input, local.recipes, 2);
  }
  if (local.recipes.length > 0) return local.recipes;
  if (input.mode === "dish") return [];

  const blocked = parseIngredients(input.allergens);
  const ingredients = parseIngredients(input.ingredients).filter(
    (ingredient) => !blocked.some((allergen) => ingredient.includes(allergen) || allergen.includes(ingredient)),
  );
  if (ingredients.length === 0) ingredients.push("豆腐", "青菜");
  return [buildPrimaryRecipe(input, ingredients), buildSecondaryRecipe(input, ingredients)];
}

const replacements: Array<[string, string]> = [
  ["鸡蛋|蛋液|蛋黄|蛋白", "嫩豆腐"],
  ["牛奶|奶油|黄油", "无糖豆浆"],
  ["鸡胸肉|鸡肉", "杏鲍菇"],
  ["猪肉|牛肉", "豆腐"],
  ["西兰花", "青菜"],
  ["辣椒|辣酱", "甜椒"],
];

function inferMissingIngredient(issue: string) {
  const direct = issue.match(/(?:没有|缺少|用完了|不想用)([^，。,.！!\s]+)/);
  return direct?.[1] ?? "";
}

export function createMockReplan(input: ReplanInput): Recipe {
  const missing = inferMissingIngredient(input.issue);
  const availableInventory = input.inventory ? parseIngredients(input.inventory) : input.recipe.inventoryCoverage?.used ?? [];
  let replacement = availableInventory.find((item) => !missing || !item.includes(missing)) ?? "现有食材";
  let matcher: RegExp | null = missing ? new RegExp(missing, "g") : null;

  for (const [source, candidate] of replacements) {
    const pattern = new RegExp(source);
    if (pattern.test(input.issue) || input.recipe.ingredients.some((item) => pattern.test(item))) {
      matcher = new RegExp(source, "g");
      replacement = availableInventory.find((item) => !pattern.test(item)) ?? candidate;
      break;
    }
  }

  if (!matcher && missing) matcher = new RegExp(missing, "g");

  const replace = (value: string) => (matcher ? value.replace(matcher, replacement) : value);
  const nextSteps = input.recipe.steps.map((step, index) =>
    index < input.currentStep
      ? step
      : {
          ...step,
          id: id("step"),
          title: replace(step.title),
          instruction: replace(step.instruction),
        },
  );

  return {
    ...input.recipe,
    id: id("recipe"),
    name: replace(input.recipe.name),
    description: `${input.recipe.description} 已根据“${input.issue}”调整后续步骤。`,
    ingredients: input.recipe.ingredients.map(replace).filter((item, index, all) => all.indexOf(item) === index),
    steps: nextSteps,
    totalMinutes: input.recipe.totalMinutes,
    tags: [...input.recipe.tags.filter((tag) => tag !== "已重规划"), "已重规划"],
    rationale: `保留已完成步骤，仅从第 ${input.currentStep + 1} 步开始替换为 ${replacement}，避免整份计划重做。`,
    feasibility: input.recipe.feasibility,
    inventoryCoverage: input.recipe.inventoryCoverage
      ? {
          ...input.recipe.inventoryCoverage,
          used: input.recipe.inventoryCoverage.used.filter((item) => !missing || !item.includes(missing)),
          pantryUsed: input.recipe.inventoryCoverage.pantryUsed,
          missing: [],
        }
      : undefined,
  };
}
