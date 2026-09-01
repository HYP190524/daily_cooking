import howToCookIndex from "@/data/howtocook-index.json";
import { goldRecipes, type GoldRecipe } from "@/data/gold-recipes";
import type { PlanInput, Recipe, RecipeDifficulty } from "./types";

interface IndexedRecipe {
  name: string;
  aliases: string[];
  category: string;
  difficulty: number;
  ingredients: string[];
  steps: string[];
  techniques: string[];
  sourcePath: string;
  sourceUrl: string;
}

const indexedRecipes = howToCookIndex.recipes as IndexedRecipe[];
const baseIngredients = ["盐", "水", "食用油", "生抽", "糖", "姜", "葱", "大蒜"];
const ingredientAliasGroups = [
  ["琵琶腿", "鸡腿", "鸡小腿", "手枪腿", "大鸡腿", "鸡腿肉"],
  ["鸡胸肉", "鸡胸", "鸡脯肉"],
  ["番茄", "西红柿"],
  ["马铃薯", "土豆"],
  ["青瓜", "黄瓜"],
  ["菜花", "花菜"],
  ["生蚝", "牡蛎"],
  ["红薯", "地瓜"],
  ["猪小排", "小排", "排骨"],
];

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeQuery(value: string) {
  return value
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/(?:怎么做|如何做|的做法|做法|菜谱|食谱)/g, "")
    .replace(/[\s，,、。！？!?;；:：\-_/]/g, "")
    .trim();
}

export function splitIngredients(value: string) {
  return value
    .split(/[，,、;；\n\s]+/)
    .map((item) => item.trim().replace(/\d+(?:\.\d+)?\s*(?:克|g|kg|个|根|片|只|毫升|ml).*$/i, ""))
    .filter((item) => item.length > 0);
}

export function textMatches(term: string, candidate: string) {
  const left = normalizeQuery(term);
  const right = normalizeQuery(candidate);
  return Boolean(left && right && (left === right || right.includes(left)));
}

export function ingredientMatchQuality(term: string, candidate: string) {
  if (textMatches(term, candidate)) return 3;
  const group = ingredientAliasGroups.find((aliases) => aliases.some((alias) => textMatches(term, alias)));
  if (!group) return 0;
  return group.some((variant) => textMatches(variant, candidate)) ? 2 : 0;
}

function difficultyLabel(level: number): RecipeDifficulty {
  if (level <= 2) return "简单";
  if (level <= 4) return "中等";
  if (level <= 6) return "困难";
  return "大师级";
}

function feasibility(totalMinutes: number, advancePrepMinutes: number, maxMinutes: number) {
  const fitsTime = totalMinutes <= maxMinutes && advancePrepMinutes === 0;
  return {
    fitsTime,
    severity: fitsTime ? ("ok" as const) : ("warning" as const),
    message: fitsTime
      ? `可在 ${maxMinutes} 分钟内完成。`
      : advancePrepMinutes > 0
        ? `需提前约 ${Math.round(advancePrepMinutes / 60)} 小时准备，总历时约 ${totalMinutes} 分钟。`
        : `真实总时长约 ${totalMinutes} 分钟，超过当前 ${maxMinutes} 分钟上限。`,
  };
}

function scaleIngredient(value: string, servings: number) {
  const factor = servings / 2;
  if (factor === 1) return value;
  return value.replace(/\d+(?:\.\d+)?/g, (amount) => {
    const scaled = Number(amount) * factor;
    return Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1).replace(/\.0$/, "");
  });
}

function fromGold(template: GoldRecipe, input: PlanInput): Recipe {
  return {
    id: uid("gold"),
    name: template.name,
    description: template.description,
    totalMinutes: template.totalMinutes,
    servings: input.servings,
    ingredients: template.ingredients.map((ingredient) => scaleIngredient(ingredient, input.servings)),
    steps: template.steps.map((step) => ({ ...step, id: uid("step") })),
    tags: template.tags,
    rationale: template.rationale,
    technique: template.technique,
    difficulty: template.difficulty,
    activeMinutes: template.activeMinutes,
    advancePrepMinutes: template.advancePrepMinutes,
    equipment: template.equipment,
    authenticity: template.authenticity,
    confidence: 0.98,
    feasibility: feasibility(template.totalMinutes, template.advancePrepMinutes, input.maxMinutes),
    source: {
      title: "Harness Demo Lite 手工校验菜谱集",
      url: "https://github.com/Anduin2017/HowToCook",
      license: "Project gold set",
      kind: "gold",
    },
  };
}

function fromIndex(template: IndexedRecipe, input: PlanInput): Recipe {
  const selectedSteps = template.steps.filter((step) => step.length <= 120).slice(0, 7);
  const totalMinutes = Math.min(120, Math.max(15, 10 + template.difficulty * 7 + selectedSteps.length * 2));
  const perStep = Math.max(2, Math.round(totalMinutes / Math.max(1, selectedSteps.length)));
  const technique = template.techniques.find((item) => item !== "其他") ?? "综合";
  return {
    id: uid("howtocook"),
    name: template.name,
    description: `从 HowToCook 本地索引召回的${template.category}做法，保留原始操作顺序。`,
    totalMinutes,
    servings: input.servings,
    ingredients: template.ingredients.slice(0, 14),
    steps: selectedSteps.map((instruction, index) => ({
      id: uid("step"),
      title: `步骤 ${index + 1}`,
      instruction,
      minutes: perStep,
    })),
    tags: [technique, template.category, `难度 ${template.difficulty} 星`],
    rationale: `菜名和食材均来自本地 ${howToCookIndex.metadata.recipeCount} 道菜索引；时间为保守估算，执行时以熟度为准。`,
    technique,
    difficulty: difficultyLabel(template.difficulty),
    activeMinutes: totalMinutes,
    advancePrepMinutes: 0,
    equipment: [],
    authenticity: "传统参考",
    confidence: 0.82,
    feasibility: feasibility(totalMinutes, 0, input.maxMinutes),
    source: {
      title: `HowToCook · ${template.name}`,
      url: template.sourceUrl,
      license: "Unlicense",
      kind: "howtocook",
    },
  };
}

function dishScore(query: string, name: string, aliases: string[]) {
  const normalized = normalizeQuery(query);
  const candidates = [name, ...aliases].map(normalizeQuery);
  if (candidates.includes(normalized)) return 100;
  if (candidates.some((candidate) => candidate.includes(normalized))) return 72;
  if (candidates.some((candidate) => normalized.includes(candidate))) return 64;
  const characters = new Set([...normalized]);
  return Math.max(...candidates.map((candidate) => [...characters].filter((char) => candidate.includes(char)).length * 4), 0);
}

function ingredientScore(wanted: string[], recipeIngredients: string[], totalMinutes: number, maxMinutes: number) {
  const qualities = wanted.map((term) =>
    Math.max(...recipeIngredients.map((ingredient) => ingredientMatchQuality(term, ingredient)), 0),
  );
  const matches = qualities.filter((quality) => quality > 0).length;
  const quality = qualities.reduce((sum, item) => sum + item, 0);
  const coverage = wanted.length ? matches / wanted.length : 0;
  const overrun = Math.max(0, totalMinutes - maxMinutes);
  const timeScore = overrun === 0 ? 12 : -Math.min(60, overrun * 1.5);
  const primaryMatched = wanted[0]
    ? recipeIngredients.some((ingredient) => ingredientMatchQuality(wanted[0], ingredient) > 0)
    : false;
  return { matches, primaryMatched, coverage, score: coverage * 100 + matches * 8 + quality * 12 + timeScore };
}

export interface LocalPlanResult {
  recipes: Recipe[];
  query: string;
  matchedNames: string[];
  indexSize: number;
  exactGoldMatch: boolean;
}

export interface LocalSearchOptions {
  limit?: number;
  diversify?: boolean;
}

export function pickDiverseRecipes(recipes: Recipe[], limit = 2) {
  const unique = recipes.filter((recipe, index, all) => all.findIndex((item) => item.name === recipe.name) === index);
  if (unique.length <= 1 || limit <= 1) return unique.slice(0, limit);

  const selected = [unique[0]];
  for (const recipe of unique.slice(1)) {
    if (selected.some((item) => item.technique === recipe.technique)) continue;
    selected.push(recipe);
    if (selected.length === limit) return selected;
  }
  for (const recipe of unique) {
    if (selected.includes(recipe)) continue;
    selected.push(recipe);
    if (selected.length === limit) break;
  }
  return selected;
}

export function searchLocalRecipes(input: PlanInput, options: LocalSearchOptions = {}): LocalPlanResult {
  if (input.mode === "dish") {
    const query = input.dishName.trim();
    const rankedGold = goldRecipes
      .map((recipe) => ({ recipe, score: dishScore(query, recipe.name, recipe.aliases) }))
      .filter((item) => item.score >= 60)
      .sort((a, b) => b.score - a.score);
    const exactGoldMatch = rankedGold.some((item) => item.score === 100);
    const selectedGold = rankedGold
      .filter((item, index, all) => normalizeQuery(item.recipe.name).includes("佛跳墙") || index === 0 || item.score === all[0]?.score)
      .slice(0, 2)
      .map((item) => fromGold(item.recipe, input));

    if (selectedGold.length) {
      return {
        recipes: selectedGold,
        query,
        matchedNames: selectedGold.map((recipe) => recipe.name),
        indexSize: indexedRecipes.length + goldRecipes.length,
        exactGoldMatch,
      };
    }

    const indexed = indexedRecipes
      .map((recipe) => ({ recipe, score: dishScore(query, recipe.name, recipe.aliases) }))
      .filter((item) => item.score >= 28)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((item) => fromIndex(item.recipe, input));
    return {
      recipes: indexed,
      query,
      matchedNames: indexed.map((recipe) => recipe.name),
      indexSize: indexedRecipes.length + goldRecipes.length,
      exactGoldMatch: false,
    };
  }

  const query = input.ingredients.trim();
  const limit = Math.min(12, Math.max(1, options.limit ?? 2));
  const diversify = options.diversify ?? true;
  const wanted = splitIngredients(query).filter((item) => !baseIngredients.some((base) => textMatches(item, base)));
  const candidates = [
    ...goldRecipes.map((recipe) => {
      const ranked = ingredientScore(wanted, recipe.ingredients, recipe.totalMinutes, input.maxMinutes);
      return { recipe: fromGold(recipe, input), ...ranked, score: ranked.score + (ranked.matches > 0 ? 8 : 0) };
    }),
    ...indexedRecipes.map((recipe) => {
      const totalMinutes = Math.min(120, Math.max(15, 10 + recipe.difficulty * 7 + Math.min(recipe.steps.length, 7) * 2));
      const ranked = ingredientScore(wanted, recipe.ingredients, totalMinutes, input.maxMinutes);
      return { recipe: fromIndex(recipe, input), ...ranked, score: ranked.score };
    }),
  ]
    .filter((candidate) => {
      const minimumMatches = wanted.length <= 1 ? 1 : Math.max(2, Math.ceil(wanted.length / 2));
      return candidate.primaryMatched && candidate.matches >= minimumMatches;
    })
    .sort((a, b) => b.score - a.score);

  const rankedRecipes = candidates.map((candidate) => candidate.recipe);
  const selected = diversify ? pickDiverseRecipes(rankedRecipes, limit) : rankedRecipes.slice(0, limit);

  return {
    recipes: selected,
    query,
    matchedNames: selected.map((recipe) => recipe.name),
    indexSize: indexedRecipes.length + goldRecipes.length,
    exactGoldMatch: false,
  };
}

export function getTechniqueCoverage() {
  const all = [...goldRecipes.map((recipe) => recipe.technique), ...indexedRecipes.flatMap((recipe) => recipe.techniques)];
  return all.reduce<Record<string, number>>((counts, technique) => {
    counts[technique] = (counts[technique] ?? 0) + 1;
    return counts;
  }, {});
}

export const localRecipeCount = indexedRecipes.length + goldRecipes.length;
