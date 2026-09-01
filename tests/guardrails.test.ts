import assert from "node:assert/strict";
import test from "node:test";
import { checkAllergens, validateCookingTime } from "../lib/guardrails";
import { createMockPlan, createMockReplan } from "../lib/mock-engine";
import type { PlanInput } from "../lib/types";

const input: PlanInput = {
  mode: "ingredients",
  dishName: "",
  ingredients: "鸡胸肉、西兰花、胡萝卜、米饭",
  planScope: "meal",
  pantry: "食用油、盐、水、生抽",
  zeroPurchase: true,
  taste: "少油、不辣",
  allergens: "花生",
  servings: 2,
  maxMinutes: 30,
};

test("local planner returns grounded recipes", () => {
  const recipes = createMockPlan(input);
  assert.equal(recipes.length, 2);
  for (const recipe of recipes) {
    assert.ok(recipe.steps.length >= 3);
    assert.ok(recipe.source);
  }
});

test("allergen guardrail fails closed when a declared allergen appears", () => {
  const [recipe] = createMockPlan(input);
  const riskyRecipe = { ...recipe, ingredients: [...recipe.ingredients, "花生酱"] };
  const result = checkAllergens(riskyRecipe, "花生");
  assert.equal(result.passed, false);
  assert.match(result.detail, /潜在风险/);
});

test("replan keeps completed steps and substitutes future egg references from inventory", () => {
  const [recipe] = createMockPlan({ ...input, ingredients: "鸡蛋、西红柿、青菜" });
  const replanned = createMockReplan({
    recipe,
    issue: "没有鸡蛋了",
    allergens: "",
    maxMinutes: 30,
    currentStep: 1,
  });
  assert.deepEqual(replanned.steps[0], recipe.steps[0]);
  assert.equal(replanned.tags.includes("已重规划"), true);
  assert.equal(replanned.steps.slice(1).some((step) => /鸡蛋|蛋液|蛋黄|蛋白/.test(step.instruction + step.title)), false);
  assert.equal(replanned.steps.slice(1).some((step) => /西红柿|青菜/.test(step.instruction + step.title)), true);
  assert.equal(replanned.ingredients.some((item) => /嫩豆腐/.test(item)), false);
});
