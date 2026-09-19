import assert from "node:assert/strict";
import test from "node:test";
import { parseDeepSeekEnvelope, selectDiversePlans } from "../lib/deepseek-planner";
import type { PlanOption } from "../lib/types";

const recipe = {
  description: "使用常见中式家常技法完成，适合两人晚餐。",
  technique: "炒",
  difficulty: "简单",
  totalMinutes: 15,
  activeMinutes: 12,
  ingredients: ["鸡蛋 3 个", "青椒 2 个", "食用油", "盐"],
  steps: [
    { title: "处理食材", instruction: "青椒洗净切块，鸡蛋加少量盐充分打散。", minutes: 5 },
    { title: "炒制完成", instruction: "先炒鸡蛋盛出，再炒青椒并回锅合炒。", minutes: 7 },
  ],
};

test("DeepSeek structured envelope rejects malformed output", () => {
  assert.throws(() => parseDeepSeekEnvelope({ plans: [{ title: "不完整" }] }), /结构不完整/);
});

test("DeepSeek structured envelope accepts complete plans", () => {
  const parsed = parseDeepSeekEnvelope({
    plans: [
      { title: "方案一", description: "两道经典家常菜，分开烹饪。", rationale: "优先消耗现有食材并控制时间。", recipes: [{ ...recipe, name: "青椒炒鸡蛋" }] },
      { title: "方案二", description: "另一套不同技法的家常搭配。", rationale: "不强迫使用全部库存。", recipes: [{ ...recipe, name: "土豆烧鸡腿", technique: "焖" }] },
    ],
  });
  assert.equal(parsed.plans.length, 2);
  assert.equal(parsed.plans[0].recipes[0].name, "青椒炒鸡蛋");
});

test("DeepSeek structured envelope accepts one plan for single-dish mode", () => {
  const parsed = parseDeepSeekEnvelope({
    plans: [
      { title: "单菜方案", description: "一锅完成的家常菜。", rationale: "覆盖本次库存并控制时间。", recipes: [{ ...recipe, name: "番茄牛肉" }] },
    ],
  }, 1);
  assert.equal(parsed.plans.length, 1);
});

function fakePlan(id: string, names: string[]): PlanOption {
  return {
    id,
    title: names.join(" + "),
    description: "测试方案",
    recipes: names.map((name, index) => ({
      id: `${id}-${index}`,
      name,
      description: "测试菜谱",
      totalMinutes: 10,
      servings: 2,
      ingredients: ["青菜", "盐"],
      steps: [],
      tags: [],
      rationale: "测试",
      technique: "炒",
      difficulty: "简单",
      activeMinutes: 10,
      advancePrepMinutes: 0,
      equipment: [],
      authenticity: "家庭版",
      confidence: 0.8,
      source: { title: "DeepSeek", url: "https://api-docs.deepseek.com/", license: "AI generated", kind: "deepseek" },
    })),
    totalMinutes: 10,
    activeMinutes: 10,
    servings: 2,
    tags: [],
    rationale: "测试",
    coverage: { used: [], unused: [], pantryUsed: [], specialtySeasonings: [], blockedSeasonings: [], missing: [], ratio: 1 },
    fitsTime: true,
    timeMessage: "符合预算",
    score: 100 - Number(id),
  };
}

test("A/B selector refuses plans that share the same dish", () => {
  const selected = selectDiversePlans([
    fakePlan("1", ["土豆烧鸡腿", "清炒青菜"]),
    fakePlan("2", ["土豆烧鸡腿", "青椒炒鸡蛋"]),
    fakePlan("3", ["红烧排骨", "青椒炒鸡蛋"]),
  ]);
  assert.deepEqual(selected.map((plan) => plan.id), ["1", "3"]);
});

test("A/B selector treats renamed cooking variants as highly similar", () => {
  const selected = selectDiversePlans([
    fakePlan("1", ["清炒青菜"]),
    fakePlan("2", ["炒青菜"]),
    fakePlan("3", ["番茄鸡蛋汤"]),
  ]);
  assert.deepEqual(selected.map((plan) => plan.id), ["1", "3"]);
});
