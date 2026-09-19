import assert from "node:assert/strict";
import test from "node:test";
import { goldRecipes } from "../data/gold-recipes";
import { ingredientMatches, normalizeIngredient } from "../lib/ingredient-normalizer";
import { buildClosestIngredientPlans, buildIngredientPlans } from "../lib/meal-planner";
import { rankPantryRecipes } from "../lib/pantry-ranker";
import { isDefaultPantryIngredient, isSpecialtySeasoning } from "../lib/pantry-presets";
import { getTechniqueCoverage, getTrustedRecipes, searchDishRecipes } from "../lib/recipe-repository";
import type { PlanInput } from "../lib/types";

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    mode: "ingredients",
    dishName: "",
    ingredients: "鸡腿、土豆、青菜、米饭",
    unavailableSeasonings: "",
    planScope: "meal",
    dishCount: 2,
    taste: "家常、不辣",
    allergens: "花生",
    servings: 2,
    maxMinutes: 60,
    ...overrides,
  };
}

test("gold set contains 23 manually checked complete recipes", () => {
  assert.equal(goldRecipes.length, 23);
  assert.equal(new Set(goldRecipes.map((recipe) => recipe.name)).size, 23);
  for (const recipe of goldRecipes) {
    assert.ok(recipe.steps.length >= 4, recipe.name);
    assert.ok(recipe.ingredients.length >= 5, recipe.name);
    assert.ok(recipe.totalMinutes >= recipe.activeMinutes, recipe.name);
  }
});

test("normalizer expands true aliases but keeps carrot and white radish distinct", () => {
  assert.equal(normalizeIngredient("琵琶腿 2只"), "鸡腿");
  assert.equal(ingredientMatches("胡萝卜", "白萝卜"), false);
  assert.equal(ingredientMatches("鸡肉", "鸡腿"), true);
});

test("dish lookup resolves real soup and complex recipes", () => {
  const soup = searchDishRecipes(input({ mode: "dish", dishName: "丝瓜鸡蛋汤怎么做", ingredients: "" }));
  assert.equal(soup[0]?.name, "丝瓜鸡蛋汤");
  assert.equal(soup[0]?.technique, "煮");
  const complex = searchDishRecipes(input({ mode: "dish", dishName: "佛跳墙", ingredients: "", maxMinutes: 30 }));
  assert.equal(complex.length, 2);
  assert.ok(complex.every((recipe) => recipe.totalMinutes > 30));
});

test("pantry ranking returns only trusted zero-purchase recipes", () => {
  const query = input();
  const matches = rankPantryRecipes(getTrustedRecipes(query), query);
  const cookable = matches.filter((match) => match.cookable);
  assert.ok(cookable.some((match) => match.recipe.name === "土豆烧鸡腿"));
  assert.ok(cookable.some((match) => match.recipe.name === "清炒青菜"));
  for (const match of cookable) {
    assert.deepEqual(match.missing, []);
    assert.ok(["gold", "howtocook"].includes(match.recipe.source.kind));
    assert.doesNotMatch(match.recipe.name, /杂蔬快炒|杂蔬焖炒|一锅焖/);
  }
});

test("default pantry removes form friction and specialty seasonings remain visible", () => {
  assert.equal(isDefaultPantryIngredient("食用盐"), true);
  assert.equal(isDefaultPantryIngredient("姜片"), true);
  assert.equal(isSpecialtySeasoning("蚝油"), true);
  assert.equal(isSpecialtySeasoning("土豆"), false);
});

test("seasonings explicitly marked unavailable exclude dependent recipes", () => {
  const query = input({ unavailableSeasonings: "料酒" });
  const matches = rankPantryRecipes(getTrustedRecipes(query), query);
  const chicken = matches.find((match) => match.recipe.name === "土豆烧鸡腿");
  assert.ok(chicken);
  assert.equal(chicken.cookable, false);
  assert.ok(chicken.blockedSeasonings.includes("料酒"));
});

test("meal planner creates separate dishes that cover the full inventory", () => {
  const query = input({ ingredients: "鸡腿、土豆、青菜" });
  const plans = buildIngredientPlans(rankPantryRecipes(getTrustedRecipes(query), query), query, 2);
  assert.ok(plans.length > 0);
  assert.ok(plans.some((plan) => plan.title.includes("土豆烧鸡腿") && plan.title.includes("清炒青菜")));
  for (const plan of plans) {
    assert.deepEqual(plan.coverage.missing, []);
    assert.ok(plan.recipes.length <= 2);
    assert.ok(plan.recipes.every((recipe) => ["gold", "howtocook"].includes(recipe.source.kind)));
  }
  assert.ok(plans.every((plan) => plan.coverage.unused.length === 0));
});

test("single-dish mode cannot silently drop a required inventory item", () => {
  const complete = input({ ingredients: "鸡腿、土豆", planScope: "single", dishCount: 1 });
  const completePlans = buildIngredientPlans(rankPantryRecipes(getTrustedRecipes(complete), complete), complete, 2);
  assert.ok(completePlans.some((plan) => plan.title.includes("土豆烧鸡腿")));
  assert.ok(completePlans.every((plan) => plan.coverage.unused.length === 0));

  const beefQuery = input({ ingredients: "牛肉、土豆、胡萝卜", planScope: "single", dishCount: 1 });
  const beefPlans = buildIngredientPlans(rankPantryRecipes(getTrustedRecipes(beefQuery), beefQuery), beefQuery, 2);
  assert.ok(beefPlans.every((plan) => plan.coverage.used.includes("牛肉")));
});

test("nearest fallback keeps a real recipe visible when one dish cannot cover all ingredients", () => {
  const query = input({ ingredients: "牛肉、土豆、番茄", planScope: "single", dishCount: 1 });
  const matches = rankPantryRecipes(getTrustedRecipes(query), query);
  const strictPlans = buildIngredientPlans(matches, query, 2);
  const nearestPlans = buildClosestIngredientPlans(matches, query, 2);
  assert.equal(strictPlans.length, 0);
  assert.ok(nearestPlans.length > 0);
  assert.ok(nearestPlans.some((plan) => plan.coverage.used.length > 0));
  assert.ok(nearestPlans.some((plan) => plan.coverage.unused.length > 0));
});

test("unknown inventory returns no false grounded match", () => {
  const query = input({ ingredients: "火星岩石" });
  const matches = rankPantryRecipes(getTrustedRecipes(query), query);
  assert.equal(matches.length, 0);
});

test("trusted corpus covers core real-world techniques", () => {
  const coverage = getTechniqueCoverage();
  for (const technique of ["炒", "蒸", "煮", "炖", "煨", "炸", "烤", "凉拌"]) {
    assert.ok((coverage[technique] ?? 0) > 0, `missing ${technique}`);
  }
});
