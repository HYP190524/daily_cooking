import assert from "node:assert/strict";
import test from "node:test";
import { goldRecipes } from "../data/gold-recipes";
import { checkRecipeComplexity, hasHardFailure, runGuardrails } from "../lib/guardrails";
import { getTechniqueCoverage, pickDiverseRecipes, searchLocalRecipes } from "../lib/recipe-index";
import type { PlanInput } from "../lib/types";

function input(overrides: Partial<PlanInput>): PlanInput {
  return {
    mode: "ingredients",
    dishName: "",
    ingredients: "丝瓜、鸡蛋",
    taste: "家常",
    allergens: "",
    servings: 2,
    maxMinutes: 30,
    ...overrides,
  };
}

test("gold set contains exactly 20 manually checked recipes", () => {
  assert.equal(goldRecipes.length, 20);
  assert.equal(new Set(goldRecipes.map((recipe) => recipe.name)).size, 20);
  for (const recipe of goldRecipes) {
    assert.ok(recipe.steps.length >= 4, recipe.name);
    assert.ok(recipe.ingredients.length >= 5, recipe.name);
    assert.ok(recipe.totalMinutes >= recipe.activeMinutes, recipe.name);
  }
});

test("dish mode resolves 丝瓜鸡蛋汤 instead of generic stir-fry or braise", () => {
  const result = searchLocalRecipes(input({ mode: "dish", dishName: "丝瓜鸡蛋汤怎么做", ingredients: "" }));
  assert.equal(result.recipes[0]?.name, "丝瓜鸡蛋汤");
  assert.equal(result.recipes[0]?.technique, "煮");
  assert.doesNotMatch(result.recipes[0]?.name ?? "", /快炒|一锅焖/);
  assert.equal(result.exactGoldMatch, true);
});

test("complex dish keeps authentic elapsed time and uses soft time warning", () => {
  const query = input({ mode: "dish", dishName: "佛跳墙", ingredients: "", maxMinutes: 30 });
  const result = searchLocalRecipes(query);
  assert.equal(result.recipes.length, 2);
  assert.ok(result.recipes.every((recipe) => recipe.totalMinutes > query.maxMinutes));
  assert.ok(result.recipes.every((recipe) => (recipe.advancePrepMinutes ?? 0) > 0));
  const checks = runGuardrails(result.recipes[0], "", query.maxMinutes, true);
  assert.equal(hasHardFailure(checks), false);
  assert.equal(checks.find((check) => check.tool === "validate_cooking_time")?.severity, "soft");
  assert.equal(checkRecipeComplexity(result.recipes[0]).passed, false);
});

test("ingredient mode selects different techniques when alternatives exist", () => {
  const result = searchLocalRecipes(input({ ingredients: "鸡蛋、西红柿、黄瓜", maxMinutes: 45 }));
  assert.equal(result.recipes.length, 2);
  assert.notEqual(result.recipes[0].technique, result.recipes[1].technique);
});

test("ingredient mode expands 琵琶腿 aliases and never returns unrelated gold recipes", () => {
  const result = searchLocalRecipes(input({ ingredients: "琵琶腿", taste: "不辣", allergens: "花生", maxMinutes: 30 }));
  assert.ok(result.recipes.length > 0);
  assert.ok(result.recipes.every((recipe) => recipe.ingredients.some((ingredient) => /鸡腿|鸡肉|手枪腿/.test(ingredient))));
  assert.equal(result.recipes.some((recipe) => /丝瓜鸡蛋汤|西红柿炒鸡蛋/.test(recipe.name)), false);
});

test("guardrail rejection backfills 琵琶腿 results from a larger candidate pool", () => {
  const query = input({ ingredients: "琵琶腿", taste: "少油、咸鲜、不辣", allergens: "花生", maxMinutes: 60 });
  const pool = searchLocalRecipes(query, { limit: 8, diversify: false }).recipes;
  const accepted = pool.filter((recipe) => !hasHardFailure(runGuardrails(recipe, query.allergens, query.maxMinutes)));
  const displayed = pickDiverseRecipes(accepted, 2);
  assert.equal(displayed.length, 2);
  assert.notEqual(displayed[0].technique, displayed[1].technique);
  assert.ok(displayed.every((recipe) => recipe.ingredients.some((ingredient) => /鸡腿|鸡肉|手枪腿/.test(ingredient))));
});

test("ingredient mode returns no grounded match instead of scoring unrelated recipes", () => {
  const result = searchLocalRecipes(input({ ingredients: "火星岩石", maxMinutes: 30 }));
  assert.deepEqual(result.recipes, []);
});

test("test corpus covers required real-world techniques", () => {
  const coverage = getTechniqueCoverage();
  for (const technique of ["炒", "蒸", "煮", "炖", "煨", "炸", "烤", "凉拌"]) {
    assert.ok((coverage[technique] ?? 0) > 0, `missing ${technique}`);
  }
});
