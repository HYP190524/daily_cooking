import { NextResponse } from "next/server";
import { hasHardFailure, runGuardrails } from "@/lib/guardrails";
import { createMockReplan, trace } from "@/lib/mock-engine";
import { canUseOpenAI, createOpenAIReplan } from "@/lib/openai";
import type { PlanInput, Recipe, ReplanInput, ReplanResponse } from "@/lib/types";

export const runtime = "nodejs";

function isRecipe(value: unknown): value is Recipe {
  if (!value || typeof value !== "object") return false;
  const recipe = value as Record<string, unknown>;
  return typeof recipe.name === "string" && Array.isArray(recipe.ingredients) && Array.isArray(recipe.steps);
}

function parseInput(value: unknown): ReplanInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (!isRecipe(input.recipe) || typeof input.issue !== "string" || !input.issue.trim()) return null;
  return {
    recipe: input.recipe,
    issue: input.issue.trim().slice(0, 160),
    allergens: typeof input.allergens === "string" ? input.allergens.trim().slice(0, 120) : "",
    maxMinutes: typeof input.maxMinutes === "number" ? Math.min(60, Math.max(15, Math.round(input.maxMinutes))) : 30,
    currentStep:
      typeof input.currentStep === "number"
        ? Math.max(0, Math.min(input.recipe.steps.length - 1, Math.round(input.currentStep)))
        : 0,
    inventory: typeof input.inventory === "string" ? input.inventory.trim().slice(0, 240) : undefined,
    pantry: typeof input.pantry === "string" ? input.pantry.trim().slice(0, 160) : undefined,
    zeroPurchase: input.zeroPurchase === true,
  };
}

export async function POST(request: Request) {
  const input = parseInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "缺少可重规划的食谱或问题描述。" }, { status: 400 });

  const startedAt = Date.now();
  const traces = [
    trace("state", "创建恢复点", `保留前 ${input.currentStep} 个已完成步骤。`, "success", 20),
    trace("tool", "inspect_available_substitutes", `分析问题：“${input.issue}”`, "success", 55),
  ];

  let recipe: Recipe;
  let mode: ReplanResponse["mode"] = "mock";
  let notice: string | undefined;

  if (canUseOpenAI()) {
    try {
      const recipes = await createOpenAIReplan(input);
      recipe = recipes[0];
      mode = "openai";
      traces.push(trace("model", "局部重规划", "模型仅修改未执行的步骤。", "success", Date.now() - startedAt));
    } catch (error) {
      recipe = createMockReplan(input);
      mode = "mock-fallback";
      notice = "模型重规划失败，已使用本地替换策略。";
      traces.push(
        trace(
          "model",
          "重规划降级",
          error instanceof Error ? error.message.slice(0, 180) : "未知模型错误",
          "warning",
          Date.now() - startedAt,
        ),
      );
    }
  } else {
    recipe = createMockReplan(input);
    traces.push(trace("model", "局部重规划", "Mock Agent 更新未执行步骤。", "success", 240));
  }

  const guardrailInput: PlanInput | undefined = input.zeroPurchase
    ? {
        mode: "ingredients",
        dishName: "",
        ingredients: recipe.inventoryCoverage?.used.join("、") ?? input.inventory ?? "",
        planScope: "single",
        pantry: input.pantry ?? recipe.inventoryCoverage?.pantryUsed.join("、") ?? "",
        zeroPurchase: true,
        taste: "",
        allergens: input.allergens,
        servings: recipe.servings,
        maxMinutes: input.maxMinutes,
      }
    : undefined;
  const checks = runGuardrails(recipe, input.allergens, input.maxMinutes, !recipe.feasibility?.fitsTime, guardrailInput);
  const passed = !hasHardFailure(checks);
  traces.push(
    trace(
      "guardrail",
      "重新校验计划",
      checks.map((check) => check.detail).join(" "),
      passed ? "success" : "warning",
      24,
    ),
  );

  if (!passed) {
    return NextResponse.json({ error: "重规划结果未通过安全与时间校验。", traces }, { status: 422 });
  }

  traces.push(trace("state", "从恢复点继续", `从第 ${input.currentStep + 1} 步继续烹饪。`, "success"));
  return NextResponse.json({ recipe, traces, mode, notice } satisfies ReplanResponse);
}
