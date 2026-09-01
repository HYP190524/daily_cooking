export type RunStatus =
  | "idle"
  | "planning"
  | "awaiting_approval"
  | "cooking"
  | "replanning"
  | "completed";

export type TraceKind = "state" | "tool" | "model" | "approval" | "guardrail";
export type TraceStatus = "queued" | "running" | "success" | "warning" | "waiting";

export interface TraceEvent {
  id: string;
  kind: TraceKind;
  label: string;
  detail: string;
  status: TraceStatus;
  durationMs?: number;
  createdAt: string;
}

export interface CookingStep {
  id: string;
  title: string;
  instruction: string;
  minutes: number;
}

export type PlanMode = "dish" | "ingredients";
export type RecipeDifficulty = "简单" | "中等" | "困难" | "大师级";

export interface RecipeSource {
  title: string;
  url: string;
  license: "Unlicense" | "Project gold set" | "AI generated";
  kind: "howtocook" | "gold" | "generated";
}

export interface RecipeFeasibility {
  fitsTime: boolean;
  severity: "ok" | "warning";
  message: string;
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  totalMinutes: number;
  servings: number;
  ingredients: string[];
  steps: CookingStep[];
  tags: string[];
  rationale: string;
  technique?: string;
  difficulty?: RecipeDifficulty;
  activeMinutes?: number;
  advancePrepMinutes?: number;
  equipment?: string[];
  authenticity?: "传统参考" | "家庭版" | "灵感方案";
  confidence?: number;
  source?: RecipeSource;
  feasibility?: RecipeFeasibility;
}

export interface PlanInput {
  mode: PlanMode;
  dishName: string;
  ingredients: string;
  taste: string;
  allergens: string;
  servings: number;
  maxMinutes: number;
}

export interface GuardrailResult {
  tool: "validate_cooking_time" | "check_allergens" | "check_recipe_complexity";
  passed: boolean;
  detail: string;
  severity?: "soft" | "hard";
}

export interface PlanResponse {
  recipes: Recipe[];
  guardrails: Record<string, GuardrailResult[]>;
  traces: TraceEvent[];
  mode: "local" | "mock" | "openai" | "mock-fallback";
  retrieval?: {
    query: string;
    indexSize: number;
    matchedNames: string[];
  };
  notice?: string;
}

export interface ReplanInput {
  recipe: Recipe;
  issue: string;
  allergens: string;
  maxMinutes: number;
  currentStep: number;
}

export interface ReplanResponse {
  recipe: Recipe;
  traces: TraceEvent[];
  mode: "local" | "mock" | "openai" | "mock-fallback";
  notice?: string;
}

export interface PersistedSession {
  input: PlanInput;
  status: RunStatus;
  recipes: Recipe[];
  selectedRecipeId: string | null;
  activeRecipe: Recipe | null;
  currentStep: number;
  completedStepIds: string[];
  traces: TraceEvent[];
  mode: PlanResponse["mode"];
}
