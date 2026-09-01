import { NextResponse } from "next/server";
import { hasHardFailure, runGuardrails } from "@/lib/guardrails";
import { createMockPlan, trace } from "@/lib/mock-engine";
import { canUseOpenAI, createOpenAIPlan } from "@/lib/openai";
import { pickDiverseRecipes, searchLocalRecipes } from "@/lib/recipe-index";
import type { PlanInput, PlanResponse, Recipe } from "@/lib/types";

export const runtime = "nodejs";

function parseInput(value: unknown): PlanInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const mode = input.mode === "dish" ? "dish" : "ingredients";
  const ingredients = typeof input.ingredients === "string" ? input.ingredients.trim().slice(0, 240) : "";
  const dishName = typeof input.dishName === "string" ? input.dishName.trim().slice(0, 80) : "";
  if (mode === "dish" ? dishName.length < 1 : ingredients.length < 1) return null;
  return {
    mode,
    dishName,
    ingredients,
    taste: typeof input.taste === "string" ? input.taste.trim().slice(0, 80) : "",
    allergens: typeof input.allergens === "string" ? input.allergens.trim().slice(0, 120) : "",
    servings: typeof input.servings === "number" ? Math.min(8, Math.max(1, Math.round(input.servings))) : 2,
    maxMinutes: typeof input.maxMinutes === "number" ? Math.min(1440, Math.max(15, Math.round(input.maxMinutes))) : 30,
  };
}

function evaluateRecipes(recipes: Recipe[], input: PlanInput) {
  const guardrails: PlanResponse["guardrails"] = {};
  for (const recipe of recipes) {
    guardrails[recipe.id] = runGuardrails(recipe, input.allergens, input.maxMinutes, input.mode === "dish");
  }
  return guardrails;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const input = parseInput(await request.json().catch(() => null));
  if (!input) {
    return NextResponse.json({ error: "请输入想做的菜名，或至少一种现有食材。" }, { status: 400 });
  }

  const queryLabel = input.mode === "dish" ? `菜名“${input.dishName}”` : `食材“${input.ingredients}”`;
  const traces = [
    trace("state", "recipe-router · 识别意图", `识别为${input.mode === "dish" ? "指定菜名" : "现有食材"}模式：${queryLabel}。`, "success", 42),
    trace("tool", "recipe-grounder · 规范化查询", `合并 ${input.servings} 人份、${input.maxMinutes} 分钟与忌口约束。`, "success", 31),
  ];

  let recipes: Recipe[];
  let mode: PlanResponse["mode"] = "local";
  let notice: string | undefined;
  const localResult = searchLocalRecipes(
    input,
    input.mode === "ingredients" ? { limit: 8, diversify: false } : undefined,
  );

  traces.push(
    trace(
      "tool",
      "search_howtocook_index",
      `在 ${localResult.indexSize} 道本地菜谱中召回：${localResult.matchedNames.join("、") || "无精确匹配"}。`,
      localResult.recipes.length ? "success" : "warning",
      18,
    ),
  );

  if (localResult.recipes.length) {
    recipes = localResult.recipes;
    notice = input.mode === "dish"
      ? "已优先使用本地可信菜谱；时间不足时会保留真实做法并明确提示。"
      : "已从 HowToCook 本地索引与 20 道手工金标菜中检索候选方案。";
    traces.push(
      trace(
        "model",
        "recipe-grounder · 组装候选",
        localResult.exactGoldMatch ? "命中手工校验菜谱，跳过自由生成。" : "使用本地来源组装候选，减少菜谱幻觉。",
        "success",
        24,
      ),
    );
  } else if (canUseOpenAI()) {
    try {
      recipes = await createOpenAIPlan(input);
      mode = "openai";
      traces.push(trace("model", "受约束生成兜底", "本地索引未命中，Responses API 返回结构化食谱。", "success", Date.now() - startedAt));
    } catch (error) {
      recipes = createMockPlan(input);
      mode = "mock-fallback";
      notice = "真实模型调用失败，已自动切换到演示引擎。";
      traces.push(
        trace(
          "model",
          "模型调用降级",
          error instanceof Error ? error.message.slice(0, 180) : "未知模型错误",
          "warning",
          Date.now() - startedAt,
        ),
      );
    }
  } else {
    recipes = createMockPlan(input);
    notice = input.mode === "dish"
      ? "本地索引未找到可信做法。可换用更完整的菜名，或在 Vercel 配置 OPENAI_API_KEY 启用受约束兜底。"
      : "本地索引未命中，已使用确定性家庭烹饪兜底。";
    traces.push(trace("model", "确定性兜底", recipes.length ? "根据食材属性选择技法。" : "未生成未经来源支持的指定菜。", recipes.length ? "success" : "warning", 22));
  }

  if (recipes.length === 0) {
    traces.push(trace("state", "停止执行", "指定菜名未在可信索引中命中，未编造做法。", "warning"));
    return NextResponse.json({ error: "本地菜谱库暂未找到这道菜。请尝试更完整的菜名，或改用“按食材推荐”。", traces }, { status: 404 });
  }

  const guardrails = evaluateRecipes(recipes, input);
  const acceptedRecipes = recipes.filter((recipe) => !hasHardFailure(guardrails[recipe.id]));
  const rejectedCount = recipes.length - acceptedRecipes.length;
  const allergenRejectedCount = recipes.filter((recipe) =>
    guardrails[recipe.id].some((result) => result.tool === "check_allergens" && !result.passed),
  ).length;
  const timeRejectedCount = recipes.filter((recipe) =>
    guardrails[recipe.id].some((result) => result.tool === "validate_cooking_time" && !result.passed && result.severity === "hard"),
  ).length;

  traces.push(
    trace(
      "guardrail",
      "complex-dish-planner · 时间与复杂度",
      `${recipes.length} 套方案已区分主动时间、总历时与提前准备。`,
      recipes.some((recipe) => !recipe.feasibility?.fitsTime) ? "warning" : "success",
      18,
    ),
    trace(
      "guardrail",
      "recipe-critic · 硬约束复核",
      rejectedCount > 0
        ? `${rejectedCount} 套方案被拦截：${timeRejectedCount} 套超时，${allergenRejectedCount} 套涉及过敏原。`
        : "时间与过敏原硬约束均通过。",
      rejectedCount > 0 ? "warning" : "success",
      12,
    ),
  );

  let finalRecipes = input.mode === "ingredients"
    ? pickDiverseRecipes(acceptedRecipes, 2)
    : acceptedRecipes.slice(0, 2);
  if (finalRecipes.length === 0) {
    const saferInput = { ...input, ingredients: input.ingredients };
    finalRecipes = createMockPlan(saferInput).filter((recipe) => !hasHardFailure(runGuardrails(recipe, input.allergens, input.maxMinutes, input.mode === "dish")));
  }

  if (finalRecipes.length === 0) {
    const timeBlocking = recipes.some((recipe) => {
      const checks = guardrails[recipe.id];
      const allergenPassed = checks.find((result) => result.tool === "check_allergens")?.passed ?? true;
      const timeFailed = checks.some((result) => result.tool === "validate_cooking_time" && !result.passed && result.severity === "hard");
      return allergenPassed && timeFailed;
    });
    const allergenBlocking = recipes.some((recipe) => {
      const checks = guardrails[recipe.id];
      const timePassed = checks.find((result) => result.tool === "validate_cooking_time")?.passed ?? true;
      const allergenFailed = checks.some((result) => result.tool === "check_allergens" && !result.passed);
      return timePassed && allergenFailed;
    });
    const timeOnly = timeBlocking && !allergenBlocking;
    const allergenOnly = allergenBlocking && !timeBlocking;
    const detail = timeOnly
      ? `找到相关菜谱，但都无法在 ${input.maxMinutes} 分钟内可靠完成。`
      : allergenOnly
        ? "相关菜谱与已声明的过敏原冲突。"
        : "相关菜谱未同时通过时间与过敏原约束。";
    traces.push(trace("state", "停止执行", detail, "warning"));
    return NextResponse.json(
      {
        error: timeOnly
          ? `找到相关做法，但没有能在 ${input.maxMinutes} 分钟内可靠完成的方案。建议把时间上限提高到 45 分钟。`
          : allergenOnly
            ? "相关菜谱可能与过敏约束冲突，请移除相关食材后重试。"
            : "相关菜谱未同时满足时间与过敏约束，请调整条件后重试。",
        traces,
      },
      { status: 422 },
    );
  }

  traces.push(trace("approval", "等待用户确认", "外部执行前暂停，由用户选择最终方案。", "waiting"));

  const response: PlanResponse = {
    recipes: finalRecipes,
    guardrails,
    traces,
    mode,
    notice,
    retrieval: {
      query: localResult.query,
      indexSize: localResult.indexSize,
      matchedNames: localResult.matchedNames,
    },
  };
  return NextResponse.json(response);
}
