import type { PlanInput, Recipe, ReplanInput } from "./types";

const recipeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    recipes: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          totalMinutes: { type: "integer" },
          ingredients: { type: "array", items: { type: "string" } },
          tags: { type: "array", items: { type: "string" } },
          rationale: { type: "string" },
          steps: {
            type: "array",
            minItems: 3,
            maxItems: 6,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                instruction: { type: "string" },
                minutes: { type: "integer" },
              },
              required: ["title", "instruction", "minutes"],
            },
          },
        },
        required: ["name", "description", "totalMinutes", "ingredients", "tags", "rationale", "steps"],
      },
    },
  },
  required: ["recipes"],
} as const;

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function extractOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const response = payload as { output_text?: unknown; output?: unknown };
  if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) return null;

  for (const item of response.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "output_text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return null;
}

function normalizeRecipe(value: unknown, servings: number, maxMinutes: number): Recipe | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.name !== "string" ||
    typeof raw.description !== "string" ||
    typeof raw.totalMinutes !== "number" ||
    !Array.isArray(raw.ingredients) ||
    !Array.isArray(raw.steps) ||
    !Array.isArray(raw.tags) ||
    typeof raw.rationale !== "string"
  ) {
    return null;
  }

  const steps = raw.steps.flatMap((step) => {
    if (!step || typeof step !== "object") return [];
    const item = step as Record<string, unknown>;
    if (typeof item.title !== "string" || typeof item.instruction !== "string" || typeof item.minutes !== "number") {
      return [];
    }
    return [
      {
        id: uid("step"),
        title: item.title,
        instruction: item.instruction,
        minutes: Math.max(1, Math.round(item.minutes)),
      },
    ];
  });

  if (steps.length < 3) return null;

  return {
    id: uid("recipe"),
    name: raw.name,
    description: raw.description,
    totalMinutes: Math.max(1, Math.round(raw.totalMinutes)),
    servings,
    ingredients: raw.ingredients.filter((item): item is string => typeof item === "string").slice(0, 14),
    tags: raw.tags.filter((item): item is string => typeof item === "string").slice(0, 4),
    rationale: raw.rationale,
    steps,
    technique: raw.tags.find((item): item is string => typeof item === "string") ?? "综合",
    difficulty: "中等",
    activeMinutes: Math.max(1, Math.round(raw.totalMinutes)),
    advancePrepMinutes: 0,
    equipment: [],
    authenticity: "灵感方案",
    confidence: 0.62,
    feasibility: {
      fitsTime: raw.totalMinutes <= maxMinutes,
      severity: raw.totalMinutes <= maxMinutes ? "ok" : "warning",
      message: raw.totalMinutes <= maxMinutes
        ? "由模型估算，执行前请人工复核熟度和时间。"
        : `模型估算约 ${Math.round(raw.totalMinutes)} 分钟，超过 ${maxMinutes} 分钟上限。`,
    },
    source: {
      title: "受约束模型生成",
      url: "https://platform.openai.com/docs/api-reference/responses",
      license: "AI generated",
      kind: "generated",
    },
  };
}

async function requestStructuredRecipes(prompt: string, servings: number, maxMinutes: number) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      store: false,
      reasoning: { effort: "low" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "cooking_plan",
          strict: true,
          schema: recipeSchema,
        },
      },
      instructions:
        "你是一个务实的家庭烹饪计划 Agent。所有内容使用简体中文。遵守时间、忌口和过敏约束；步骤必须可执行，不提供医疗承诺。",
      input: prompt,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${message.slice(0, 240)}`);
  }

  const payload = (await response.json()) as unknown;
  const outputText = extractOutputText(payload);
  if (!outputText) throw new Error("OpenAI response did not contain output_text");

  const parsed = JSON.parse(outputText) as { recipes?: unknown };
  if (!Array.isArray(parsed.recipes)) throw new Error("OpenAI response did not match recipe schema");
  const recipes = parsed.recipes.flatMap((recipe) => {
    const normalized = normalizeRecipe(recipe, servings, maxMinutes);
    return normalized ? [normalized] : [];
  });
  if (recipes.length === 0) throw new Error("OpenAI returned no usable recipe");
  return recipes;
}

export function canUseOpenAI() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function createOpenAIPlan(input: PlanInput) {
  return requestStructuredRecipes(
    [
      "请生成两套候选食谱。",
      `输入模式：${input.mode === "dish" ? "指定菜名" : "现有食材"}`,
      input.mode === "dish" ? `目标菜名：${input.dishName}` : `已有食材：${input.ingredients}`,
      `人数：${input.servings}`,
      `口味偏好：${input.taste || "家常"}`,
      `过敏原或绝对禁忌：${input.allergens || "无"}`,
      `总时间上限：${input.maxMinutes} 分钟`,
      "指定菜名模式不得为了迎合时间上限而改变菜品身份；若真实时间更长，应给出真实 totalMinutes。食材模式优先使用已有食材。可以加入盐、油、水等基础调料。totalMinutes 必须包括准备和烹饪时间。",
    ].join("\n"),
    input.servings,
    input.maxMinutes,
  );
}

export function createOpenAIReplan(input: ReplanInput) {
  const completedSteps = input.recipe.steps.slice(0, input.currentStep).map((step) => step.title).join("、") || "无";
  return requestStructuredRecipes(
    [
      "请对下面的食谱进行局部重规划，只返回一套修订方案。",
      `问题：${input.issue}`,
      `原食谱：${JSON.stringify(input.recipe)}`,
      `已经完成且不可改变的步骤：${completedSteps}`,
      `从第 ${input.currentStep + 1} 步开始修改。`,
      `过敏原或禁忌：${input.allergens || "无"}`,
      `总时间上限：${input.maxMinutes} 分钟。`,
    ].join("\n"),
    input.recipe.servings,
    input.maxMinutes,
  ).then((recipes) => recipes.slice(0, 1));
}
