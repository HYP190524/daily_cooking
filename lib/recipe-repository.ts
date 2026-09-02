import howToCookIndex from "@/data/howtocook-index.json";
import { goldRecipes, type GoldRecipe } from "@/data/gold-recipes";
import { normalizeDishQuery } from "./ingredient-normalizer";
import type { PlanInput, Recipe, RecipeDifficulty } from "./types";

interface IndexedRecipe {
  name: string;
  aliases: string[];
  category: string;
  difficulty: number;
  ingredients: string[];
  steps: string[];
  techniques: string[];
  sourceUrl: string;
}

const indexedRecipes = howToCookIndex.recipes as IndexedRecipe[];

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function difficultyLabel(level: number): RecipeDifficulty {
  if (level <= 2) return "简单";
  if (level <= 4) return "中等";
  if (level <= 6) return "困难";
  return "大师级";
}

function scaleIngredient(value: string, servings: number) {
  const factor = servings / 2;
  if (factor === 1) return value;
  return value.replace(/\d+(?:\.\d+)?/g, (amount) => {
    const scaled = Number(amount) * factor;
    return Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1).replace(/\.0$/, "");
  });
}

function estimateIndexedMinutes(template: IndexedRecipe) {
  const explicit = template.steps.flatMap((step) => {
    const matches = [...step.matchAll(/(\d{1,3})(?:\s*[-–至]\s*(\d{1,3}))?\s*分钟/g)];
    return matches.map((match) => match[2] ? Math.ceil((Number(match[1]) + Number(match[2])) / 2) : Number(match[1]));
  });
  if (explicit.length) return Math.min(180, Math.max(12, explicit.reduce((sum, value) => sum + value, 0) + 8));
  return Math.min(120, Math.max(15, 12 + template.difficulty * 8 + Math.min(template.steps.length, 7) * 2));
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
    source: {
      title: "Harness Demo Lite 手工校验菜谱集",
      url: "https://github.com/Anduin2017/HowToCook",
      license: "Project gold set",
      kind: "gold",
    },
  };
}

function fromIndex(template: IndexedRecipe, input: PlanInput): Recipe {
  const steps = template.steps.filter((step) => step.length <= 180).slice(0, 8);
  const totalMinutes = estimateIndexedMinutes(template);
  const perStep = Math.max(2, Math.round(totalMinutes / Math.max(1, steps.length)));
  const technique = template.techniques.find((item) => item !== "其他") ?? "综合";
  return {
    id: uid("howtocook"),
    name: template.name,
    description: `来自 HowToCook 的${template.category}菜谱，菜名、食材和步骤均保留来源。`,
    totalMinutes,
    servings: input.servings,
    ingredients: template.ingredients.slice(0, 18),
    steps: steps.map((instruction, index) => ({
      id: uid("step"),
      title: `步骤 ${index + 1}`,
      instruction,
      minutes: perStep,
    })),
    tags: [technique, template.category, `难度 ${template.difficulty} 星`],
    rationale: "可信菜谱召回结果；没有使用生成模板改写菜品身份。",
    technique,
    difficulty: difficultyLabel(template.difficulty),
    activeMinutes: totalMinutes,
    advancePrepMinutes: 0,
    equipment: [],
    authenticity: "传统参考",
    confidence: 0.84,
    source: {
      title: `HowToCook · ${template.name}`,
      url: template.sourceUrl,
      license: "Unlicense",
      kind: "howtocook",
    },
  };
}

function dishScore(query: string, name: string, aliases: string[]) {
  const normalized = normalizeDishQuery(query);
  const candidates = [name, ...aliases].map(normalizeDishQuery);
  if (candidates.includes(normalized)) return 100;
  if (candidates.some((candidate) => candidate.includes(normalized))) return 76;
  if (candidates.some((candidate) => normalized.includes(candidate))) return 66;
  const characters = new Set([...normalized]);
  return Math.max(...candidates.map((candidate) => [...characters].filter((char) => candidate.includes(char)).length * 4), 0);
}

export function getTrustedRecipes(input: PlanInput) {
  const all = [
    ...goldRecipes.map((recipe) => fromGold(recipe, input)),
    ...indexedRecipes.map((recipe) => fromIndex(recipe, input)),
  ];
  return all.filter((recipe, index) =>
    all.findIndex((candidate) => candidate.name === recipe.name) === index,
  );
}

export function searchDishRecipes(input: PlanInput, limit = 2) {
  const query = input.dishName.trim();
  const gold = goldRecipes.map((recipe) => ({ recipe: fromGold(recipe, input), score: dishScore(query, recipe.name, recipe.aliases) }));
  const indexed = indexedRecipes.map((recipe) => ({ recipe: fromIndex(recipe, input), score: dishScore(query, recipe.name, recipe.aliases) }));
  return [...gold, ...indexed]
    .filter((item) => item.score >= 32)
    .sort((left, right) => right.score - left.score || right.recipe.confidence - left.recipe.confidence)
    .filter((item, index, all) => all.findIndex((candidate) => candidate.recipe.name === item.recipe.name) === index)
    .slice(0, limit)
    .map((item) => item.recipe);
}

export function getTechniqueCoverage() {
  const all = [...goldRecipes.map((recipe) => recipe.technique), ...indexedRecipes.flatMap((recipe) => recipe.techniques)];
  return all.reduce<Record<string, number>>((counts, technique) => {
    counts[technique] = (counts[technique] ?? 0) + 1;
    return counts;
  }, {});
}

export const trustedRecipeCount = indexedRecipes.length + goldRecipes.length;
