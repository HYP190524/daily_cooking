import { NextResponse } from "next/server";
import { generateDeepSeekPlans, selectDiversePlans } from "@/lib/deepseek-planner";
import { hasHardFailure, runPlanGuardrails } from "@/lib/guardrails";
import { splitIngredientInput } from "@/lib/ingredient-normalizer";
import { buildClosestIngredientPlans, buildDishPlans, buildIngredientPlans } from "@/lib/meal-planner";
import { rankPantryRecipes, summarizeNearest } from "@/lib/pantry-ranker";
import { getTrustedRecipes, searchDishRecipes, trustedRecipeCount } from "@/lib/recipe-repository";
import { trace } from "@/lib/trace";
import type { PlanInput, PlanOption, PlanResponse } from "@/lib/types";

export const runtime = "nodejs";

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
    unavailableSeasonings: text(data.unavailableSeasonings, 160),
    planScope: data.planScope === "meal" ? "meal" : "single",
    dishCount: data.planScope === "meal"
      ? typeof data.dishCount === "number" ? Math.min(4, Math.max(2, Math.round(data.dishCount))) : 2
      : 1,
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
        : `识别 ${splitIngredientInput(input.ingredients).length} 种现有主要食材，默认尝试全部覆盖。`,
      "success",
      8,
    ),
  ];

  let plans: PlanOption[] = [];
  let responseMode: PlanResponse["mode"] = "local";
  let candidateCount = 0;
  let cookableCount = 0;
  let matchedNames: string[] = [];
  let partialInventoryFallback = false;

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
    if (process.env.DEEPSEEK_API_KEY) {
      try {
        const generated = await generateDeepSeekPlans(input);
        plans = generated.plans;
        responseMode = "deepseek";
        candidateCount = plans.length;
        cookableCount = plans.length;
        matchedNames = plans.flatMap((plan) => plan.recipes.map((recipe) => recipe.name));
        traces.push(
          trace(
            "planner",
            "deepseek-meal-planner · 结构化生成",
            `${generated.model} 生成候选并完成 ${generated.attempts} 轮校验；${generated.rejectedCount} 套不合格方案被拒绝。`,
            "success",
            0,
          ),
          trace(
            "tool",
            "json-schema-parser · 结构解析",
            `已得到 ${plans.length} 套互不重复的结构化菜单，每套恰好 ${input.planScope === "single" ? 1 : input.dishCount} 道菜。`,
            "success",
            0,
          ),
        );
      } catch (error) {
        responseMode = "local_fallback";
        const detail = error instanceof Error ? error.message : "未知错误";
        traces.push(trace("planner", "deepseek-meal-planner · 安全降级", `${detail} 已自动切换到本地可信菜谱。`, "warning"));
      }
    } else {
      traces.push(trace("planner", "deepseek-meal-planner · 未启用", "未检测到服务端 DEEPSEEK_API_KEY，使用本地可信菜谱兜底。", "warning"));
    }

    if (!plans.length) {
      const recipes = getTrustedRecipes(input);
      const matches = rankPantryRecipes(recipes, input);
      const cookable = matches.filter((match) => match.cookable);
      candidateCount = matches.length;
      cookableCount = cookable.length;
      matchedNames = matches.slice(0, 8).map((match) => match.recipe.name);
      plans = selectDiversePlans(buildIngredientPlans(matches, input, 8), 2);
      // A partial recipe is only a valid fallback when the user explicitly
      // chose meal mode. Single-dish mode promises one dish covering all
      // entered ingredients, so never show a potato-only plan for beef/tomato
      // inventory just because it is the highest local score.
      if (!plans.length && cookable.length && input.planScope === "meal") {
        plans = selectDiversePlans(buildClosestIngredientPlans(matches, input, 8), 2);
        partialInventoryFallback = plans.some((plan) => plan.coverage.unused.length > 0);
      }
      traces.push(
        trace(
          "tool",
          "trusted-recipe-retriever · 本地兜底召回",
          `扫描 ${trustedRecipeCount} 道真实菜谱，找到 ${candidateCount} 道含现有食材的候选。`,
          candidateCount ? "success" : "warning",
          19,
        ),
        trace(
          "planner",
          "pantry-ranker · 库存闭包排序",
          `${cookableCount} 道菜无需新增主要食材；基础调料默认拥有，特殊调料单独提示。`,
          cookableCount ? "success" : "warning",
          13,
        ),
        trace(
          "planner",
          "meal-set-planner · 一餐组合",
          plans.length
            ? partialInventoryFallback
              ? `没有找到完整覆盖全部库存的方案，展示 ${plans.length} 套最接近真实菜谱，并标出未覆盖食材。`
              : `组合出 ${plans.length} 套覆盖全部主要食材的可信方案。`
            : "没有形成满足主要食材闭包的真实一餐。",
          plans.length ? "success" : "warning",
          11,
        ),
      );

      if (!plans.length) {
        const nearest = summarizeNearest(matches);
        traces.push(trace("state", "停止执行", "没有找到任何不缺主要食材的可信菜谱，系统拒绝展示无法执行的方案。", "warning"));
        return NextResponse.json(
          {
            error: nearest.length
              ? input.planScope === "single"
                ? `单菜模式要求一道菜覆盖全部主要食材，当前没有满足“${input.ingredients}”的可信菜谱。最接近的是：${nearest.join("；")}。请切换“多道菜·分开消耗”，或减少本次库存。`
                : `暂时没有可执行的完整方案。最接近的是：${nearest.join("；")}。`
              : "暂时没有找到使用这些食材的可执行方案，请尝试更常见的食材名称。",
            traces,
          },
          { status: 422 },
        );
      }
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
        ? partialInventoryFallback
          ? "来源、过敏原和一餐结构通过；未覆盖库存作为软提示展示。"
          : "来源、过敏原、主要食材闭包和一餐结构硬约束全部通过。"
        : `${plans.length - accepted.length} 套方案被硬约束拦截。`,
      accepted.length === plans.length ? "success" : "warning",
      9,
    ),
  );

  if (!accepted.length) {
    return NextResponse.json({ error: "候选方案未通过安全或主要食材校验，请调整过敏原或库存。", traces }, { status: 422 });
  }

  traces.push(trace("approval", "Human-in-the-loop · 等待确认", "Agent 已暂停；请选择一套真实方案后再开始做饭。", "waiting"));
  const response: PlanResponse = {
    plans: accepted,
    guardrails,
    traces,
    mode: responseMode,
    retrieval: {
      query: input.mode === "dish" ? input.dishName : input.ingredients,
      indexSize: trustedRecipeCount,
      candidateCount,
      cookableCount,
      matchedNames,
    },
    notice: input.mode === "dish"
      ? "只返回有本地来源的完整菜谱；不会为了时间限制改写成快手模板。"
      : partialInventoryFallback
      ? "没有找到一条真实菜谱覆盖全部库存，已展示最接近的方案；未覆盖食材会明确列出，建议切换多道菜。"
      : responseMode === "deepseek"
      ? "DeepSeek 已按结构化约束规划，结果又经过本地 Guardrail 复核；特殊调料会单独提示。"
      : "DeepSeek 当前未启用或不可用，已使用本地可信菜谱兜底；主要食材仍坚持零新增。",
  };
  return NextResponse.json(response);
}
