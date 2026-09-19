export type RunStatus = "idle" | "planning" | "awaiting_approval" | "cooking" | "completed";

export type TraceKind = "state" | "tool" | "planner" | "approval" | "guardrail";
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
export type PlanScope = "single" | "meal";
export type RecipeDifficulty = "简单" | "中等" | "困难" | "大师级";

export interface RecipeSource {
  title: string;
  url: string;
  license: "Unlicense" | "Project gold set" | "AI generated";
  kind: "howtocook" | "gold" | "deepseek";
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
  technique: string;
  difficulty: RecipeDifficulty;
  activeMinutes: number;
  advancePrepMinutes: number;
  equipment: string[];
  authenticity: "传统参考" | "家庭版";
  confidence: number;
  source: RecipeSource;
}

export interface PlanInput {
  mode: PlanMode;
  dishName: string;
  ingredients: string;
  unavailableSeasonings: string;
  planScope: PlanScope;
  dishCount: number;
  taste: string;
  allergens: string;
  servings: number;
  maxMinutes: number;
}

export interface PantryCoverage {
  used: string[];
  unused: string[];
  pantryUsed: string[];
  specialtySeasonings: string[];
  blockedSeasonings: string[];
  missing: string[];
  ratio: number;
}

export interface PlanOption {
  id: string;
  title: string;
  description: string;
  recipes: Recipe[];
  totalMinutes: number;
  activeMinutes: number;
  servings: number;
  tags: string[];
  rationale: string;
  coverage: PantryCoverage;
  fitsTime: boolean;
  timeMessage: string;
  score: number;
}

export interface GuardrailResult {
  tool:
    | "check_source_grounding"
    | "check_allergens"
    | "check_no_purchase"
    | "check_seasoning_assumptions"
    | "check_time_budget"
    | "check_meal_coherence";
  passed: boolean;
  detail: string;
  severity: "soft" | "hard";
}

export interface PlanResponse {
  plans: PlanOption[];
  guardrails: Record<string, GuardrailResult[]>;
  traces: TraceEvent[];
  mode: "deepseek" | "local" | "local_fallback";
  retrieval: {
    query: string;
    indexSize: number;
    candidateCount: number;
    cookableCount: number;
    matchedNames: string[];
  };
  notice?: string;
}

export interface PersistedSession {
  version: 5;
  input: PlanInput;
  status: RunStatus;
  plans: PlanOption[];
  selectedPlanId: string | null;
  activePlan: PlanOption | null;
  traces: TraceEvent[];
}
