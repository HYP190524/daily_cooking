import { NextResponse } from "next/server";
import { hasHardFailure, runPlanGuardrails } from "@/lib/guardrails";
import { splitIngredientInput } from "@/lib/ingredient-normalizer";
import { buildDishPlans, buildIngredientPlans } from "@/lib/meal-planner";
import { rankPantryRecipes, summarizeNearest } from "@/lib/pantry-ranker";
import { getTrustedRecipes, searchDishRecipes, trustedRecipeCount } from "@/lib/recipe-repository";
import { trace } from "@/lib/trace";
import type { PlanInput, PlanResponse } from "@/lib/types";

export const runtime = "nodejs";

const defaultPantry = "食用油、盐、水、生抽、老抽、料酒、白糖、醋、葱、姜、蒜、淀粉、蚝油";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseInput(value: unknown): PlanInput | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const mode = data.mode === "dish" ? "dish" : "ingredients";
  const dishName = text(data.dishName, 80);
  const ingredients = text(data.ingredients, 240);
  if (mode === "dish" ? !dishName : !ingredients) return null;
  return {
    mode,
    dishName,
    ingredients,
    priorityIngredients: text(data.priorityIngredients, 160),
    pantry: text(data.pantry, 240) || defaultPantry,
    planScope: data.planScope === "single" ? "single" : "meal",
    taste: text(data.taste, 80),
    allergens: text(data.allergens, 120),
    servings: typeof data.servings === "number" ? Math.min(8, Math.max(1, Math.round(data.servings))) : 2,
    maxMinutes: typeof data.maxMinutes === "number" ? Math.min(1440, Math.max(15, Math.round(data.maxMinutes))) : 60,
  };
}

export async function POST(request: Request) {
  const input = parseInput(await request.json().catch(() => null));
  if (!input) {
    return NextResponse.json({ error: "请输入菜名，或至少一种冰箱现有食材。" }, { status: 400 });
  }

  const traces = [
    trace(
      "tool",
      "ingredient-normalizer · 食材归一化",
      input.mode === "dish"
        ? `规范化菜名“${input.dishName}”。`
        : `识别 ${splitIngredientInput(input.ingredients).length} 种现有食材与 ${splitIngredientInput(input.priorityIngredients).length} 种优先食材。`,
      "success",
      8,
    ),
  ];

  let plans;
  let candidateCount = 0;
  let cookableCount = 0;
  let matchedNames: string[] = [];

  if (input.mode === "dish") {
    const recipes = searchDishRecipes(input, 4);
    candidateCount = recipes.length;
    cookableCount = recipes.length;
    matchedNames = recipes.map((recipe) => recipe.name);
    plans = buildDishPlans(recipes, input);
    traces.push(
      trace(
        "tool",
        "trusted-recipe-retriever · 可信召回",
        recipes.length ? `从 ${trustedRecipeCount} 道可信菜谱中召回：${matchedNames.join("、")}。` : `本地可信库未命中“${input.dishName}”。`,
        recipes.length ? "success" : "warning",
        17,
      ),
    );
  } else {
    const recipes = getTrustedRecipes(input);
    const matches = rankPantryRecipes(recipes, input);
    const cookable = matches.filter((match) => match.cookable);
    candidateCount = matches.length;
    cookableCount = cookable.length;
    matchedNames = matches.slice(0, 8).map((match) => match.recipe.name);
    plans = buildIngredientPlans(matches, input, 2);
    traces.push(
      trace(
        "tool",
        "trusted-recipe-retriever · 可信召回",
        `扫描 ${trustedRecipeCount} 道真实菜谱，找到 ${candidateCount} 道含现有食材的候选。`,
        candidateCount ? "success" : "warning",
        19,
      ),
      trace(
        "planner",
        "pantry-ranker · 零采购排序",
        `${cookableCount} 道菜可只用现有食材和已声明调料完成；缺料候选不会进入执行区。`,
        cookableCount ? "success" : "warning",
        13,
      ),
      trace(
        "planner",
        "meal-set-planner · 一餐组合",
        plans.length ? `组合出 ${plans.length} 套可信方案，不强迫一顿用完全部库存。` : "没有形成满足零采购约束的真实一餐。",
        plans.length ? "success" : "warning",
        11,
      ),
    );

    if (!plans.length) {
      const nearest = summarizeNearest(matches);
      traces.push(trace("state", "停止执行", "没有可信菜谱能在零采购条件下闭环，系统拒绝编造菜名。", "warning"));
      return NextResponse.json(
        {
          error: nearest.length
            ? `暂时没有可零采购完成的可信菜谱。最接近的是：${nearest.join("；")}。可补充你家已有的基础调料后重试。`
            : "暂时没有找到使用这些食材的可信菜谱，请尝试更常见的食材名称。",
          traces,
        },
        { status: 422 },
      );
    }
  }

  if (!plans.length) {
    traces.push(trace("state", "停止执行", "可信菜谱库没有匹配结果，未启用自由生成兜底。", "warning"));
    return NextResponse.json(
      { error: "本地可信菜谱库暂未找到这道菜。请换一个更完整的菜名，或改用按食材推荐。", traces },
      { status: 404 },
    );
  }

  const guardrails: PlanResponse["guardrails"] = {};
  for (const plan of plans) guardrails[plan.id] = runPlanGuardrails(plan, input);
  const accepted = plans.filter((plan) => !hasHardFailure(guardrails[plan.id]));
  traces.push(
    trace(
      "guardrail",
      "plan-guardrails · 确定性复核",
      accepted.length === plans.length
        ? "来源、过敏原、零采购和一餐结构硬约束全部通过。"
        : `${plans.length - accepted.length} 套方案被硬约束拦截。`,
      accepted.length === plans.length ? "success" : "warning",
      9,
    ),
  );

  if (!accepted.length) {
    return NextResponse.json({ error: "候选方案未通过安全或零采购校验，请调整过敏原或库存。", traces }, { status: 422 });
  }

  traces.push(trace("approval", "Human-in-the-loop · 等待确认", "Agent 已暂停；请选择一套真实方案后再开始做饭。", "waiting"));
  const response: PlanResponse = {
    plans: accepted,
    guardrails,
    traces,
    mode: "local",
    retrieval: {
      query: input.mode === "dish" ? input.dishName : input.ingredients,
      indexSize: trustedRecipeCount,
      candidateCount,
      cookableCount,
      matchedNames,
    },
    notice: input.mode === "dish"
      ? "只返回有本地来源的完整菜谱；不会为了时间限制改写成快手模板。"
      : "只执行零新增食材的真实菜谱；未用库存会保留到下一顿，不会强行混菜。",
  };
  return NextResponse.json(response);
}
