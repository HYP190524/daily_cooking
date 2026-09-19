import assert from "node:assert/strict";
import test from "node:test";
import {
  checkAllergens,
  checkNoPurchase,
  checkSeasoningAssumptions,
  checkSourceGrounding,
  checkTimeBudget,
  hasHardFailure,
  runPlanGuardrails,
} from "../lib/guardrails";
import { buildDishPlans, buildIngredientPlans } from "../lib/meal-planner";
import { rankPantryRecipes } from "../lib/pantry-ranker";
import { getTrustedRecipes, searchDishRecipes } from "../lib/recipe-repository";
import type { PlanInput, PlanOption } from "../lib/types";

const input: PlanInput = {
  mode: "ingredients",
  dishName: "",
  ingredients: "鸡腿、土豆、青菜",
  unavailableSeasonings: "",
  planScope: "meal",
  dishCount: 2,
  taste: "家常、不辣",
  allergens: "花生",
  servings: 2,
  maxMinutes: 60,
};

function trustedPlan() {
  const plan = buildIngredientPlans(rankPantryRecipes(getTrustedRecipes(input), input), input, 1)[0];
  assert.ok(plan);
  return plan;
}

test("trusted meal passes all hard guardrails", () => {
  const checks = runPlanGuardrails(trustedPlan(), input);
  assert.equal(hasHardFailure(checks), false);
  assert.equal(checks.find((check) => check.tool === "check_no_purchase")?.passed, true);
  assert.equal(checks.find((check) => check.tool === "check_source_grounding")?.passed, true);
});

test("allergen guardrail fails closed", () => {
  const plan = trustedPlan();
  const risky: PlanOption = {
    ...plan,
    recipes: [{ ...plan.recipes[0], ingredients: [...plan.recipes[0].ingredients, "花生酱"] }, ...plan.recipes.slice(1)],
  };
  const check = checkAllergens(risky, "花生");
  assert.equal(check.passed, false);
  assert.equal(check.severity, "hard");
});

test("time overrun is honest soft warning, not a fake fast recipe", () => {
  const plan = { ...trustedPlan(), totalMinutes: 95 };
  const check = checkTimeBudget(plan, 30);
  assert.equal(check.passed, false);
  assert.equal(check.severity, "soft");
  assert.match(check.detail, /真实做法/);
});

test("generated plans that exceed the selected time are rejected", () => {
  const plan = trustedPlan();
  const generated = {
    ...plan,
    totalMinutes: 95,
    recipes: plan.recipes.map((recipe) => ({
      ...recipe,
      source: { title: "DeepSeek", url: "https://api-docs.deepseek.com/", license: "AI generated" as const, kind: "deepseek" as const },
    })),
  };
  const check = checkTimeBudget(generated, 30);
  assert.equal(check.passed, false);
  assert.equal(check.severity, "hard");
});

test("dish lookup preserves original recipe without inventory closure", () => {
  const dishInput = { ...input, mode: "dish" as const, dishName: "佛跳墙", ingredients: "", maxMinutes: 30 };
  const plan = buildDishPlans(searchDishRecipes(dishInput, 1), dishInput)[0];
  const checks = runPlanGuardrails(plan, dishInput);
  assert.equal(hasHardFailure(checks), false);
  assert.equal(checks.find((check) => check.tool === "check_no_purchase")?.passed, true);
  assert.equal(checks.find((check) => check.tool === "check_time_budget")?.severity, "soft");
});

test("missing groceries and ungrounded sources are hard failures", () => {
  const plan = trustedPlan();
  const missing = { ...plan, coverage: { ...plan.coverage, missing: ["牛奶"] } };
  assert.equal(checkNoPurchase(missing, input).passed, false);
  const ungrounded: PlanOption = {
    ...plan,
    recipes: [{
      ...plan.recipes[0],
      source: { ...plan.recipes[0].source, kind: "generated" as never },
    }],
  };
  assert.equal(checkSourceGrounding(ungrounded).passed, false);
});

test("local nearest fallback discloses leftover inventory as a soft warning", () => {
  const plan = trustedPlan();
  const partial = { ...plan, coverage: { ...plan.coverage, unused: ["番茄"] } };
  const check = checkNoPurchase(partial, input);
  assert.equal(check.passed, false);
  assert.equal(check.severity, "soft");
});

test("specialty seasonings are disclosed softly while explicit exclusions fail closed", () => {
  const plan = trustedPlan();
  const specialty = {
    ...plan,
    coverage: { ...plan.coverage, specialtySeasonings: ["蚝油"] },
  };
  const warning = checkSeasoningAssumptions(specialty);
  assert.equal(warning.passed, false);
  assert.equal(warning.severity, "soft");

  const blocked = {
    ...plan,
    coverage: { ...plan.coverage, blockedSeasonings: ["料酒"] },
  };
  assert.equal(checkNoPurchase(blocked, input).passed, false);
});
