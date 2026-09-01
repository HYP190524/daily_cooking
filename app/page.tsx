"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import Image from "next/image";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChefHat,
  Circle,
  Clock3,
  Code2,
  CookingPot,
  Gauge,
  GitBranch,
  LoaderCircle,
  LockKeyhole,
  Play,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  TimerReset,
  UserCheck,
  Utensils,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  PersistedSession,
  PlanInput,
  PlanResponse,
  Recipe,
  ReplanResponse,
  RunStatus,
  TraceEvent,
  TraceKind,
} from "@/lib/types";

gsap.registerPlugin(useGSAP);

const STORAGE_KEY = "kaifan-harness-demo-v1";

const defaultInput: PlanInput = {
  mode: "ingredients",
  dishName: "丝瓜鸡蛋汤",
  ingredients: "鸡胸肉、西兰花、胡萝卜、米饭",
  taste: "少油、咸鲜、不辣",
  allergens: "花生",
  servings: 2,
  maxMinutes: 30,
};

const statusMeta: Record<RunStatus, { label: string; description: string }> = {
  idle: { label: "等待任务", description: "填写约束并启动 Agent" },
  planning: { label: "规划中", description: "正在调用模型与确定性工具" },
  awaiting_approval: { label: "等待审批", description: "Agent 已暂停，等待你选择方案" },
  cooking: { label: "执行中", description: "按步骤推进，随时可以重规划" },
  replanning: { label: "重规划", description: "从 checkpoint 调整未执行步骤" },
  completed: { label: "已完成", description: "任务闭环已记录" },
};

const traceIcons: Record<TraceKind, typeof Wrench> = {
  state: GitBranch,
  tool: Wrench,
  model: Sparkles,
  approval: UserCheck,
  guardrail: ShieldCheck,
};

const stateOrder: Array<{ key: RunStatus; label: string }> = [
  { key: "idle", label: "任务输入" },
  { key: "planning", label: "生成与校验" },
  { key: "awaiting_approval", label: "人工确认" },
  { key: "cooking", label: "执行计划" },
  { key: "completed", label: "完成" },
];

function stateIndex(status: RunStatus) {
  if (status === "replanning") return 3;
  return stateOrder.findIndex((item) => item.key === status);
}

function clientTrace(
  kind: TraceKind,
  label: string,
  detail: string,
  status: TraceEvent["status"] = "success",
): TraceEvent {
  return {
    id: `client-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    label,
    detail,
    status,
    createdAt: new Date().toISOString(),
  };
}

function formatClock(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function safeReadSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}

export default function Home() {
  const pageRef = useRef<HTMLElement>(null);
  const [hydrated, setHydrated] = useState(true);
  const [input, setInput] = useState<PlanInput>(defaultInput);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [activeRecipe, setActiveRecipe] = useState<Recipe | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [completedStepIds, setCompletedStepIds] = useState<string[]>([]);
  const [traces, setTraces] = useState<TraceEvent[]>([]);
  const [mode, setMode] = useState<PlanResponse["mode"]>("mock");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issue, setIssue] = useState("没有鸡胸肉了，请帮我调整后面的步骤");
  const [showTraceOnMobile, setShowTraceOnMobile] = useState(false);
  const traceListRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!hydrated) return;
    const media = gsap.matchMedia();
    media.add(
      {
        desktop: "(min-width: 821px)",
        reduceMotion: "(prefers-reduced-motion: reduce)",
      },
      (context) => {
        const { desktop, reduceMotion } = context.conditions as {
          desktop: boolean;
          reduceMotion: boolean;
        };

        if (reduceMotion) return;

        gsap.from(".hero-word", {
          yPercent: 110,
          rotation: 2,
          autoAlpha: 0,
          duration: 0.75,
          ease: "power3.out",
          stagger: 0.07,
        });
        gsap.from(".hero-collage", {
          scale: 0.82,
          rotation: desktop ? 5 : 0,
          autoAlpha: 0,
          duration: 0.9,
          ease: "back.out(1.35)",
          delay: 0.12,
        });
        gsap.from(".hero-sticker", {
          scale: 0,
          rotation: (index) => (index % 2 ? 14 : -14),
          duration: 0.6,
          stagger: 0.08,
          ease: "back.out(1.8)",
          delay: 0.45,
        });
      },
    );
    return () => media.revert();
  }, { scope: pageRef, dependencies: [hydrated], revertOnUpdate: true });

  useGSAP(() => {
    if (!hydrated || status !== "awaiting_approval") return;
    gsap.from(".recipe-card", {
      y: 56,
      rotation: (index) => (index % 2 ? 2.5 : -2.5),
      autoAlpha: 0,
      duration: 0.55,
      stagger: 0.1,
      ease: "power3.out",
    });
  }, { scope: pageRef, dependencies: [hydrated, status, recipes.length], revertOnUpdate: true });

  useEffect(() => {
    const saved = safeReadSession();
    if (saved) {
      setInput({
        ...defaultInput,
        ...saved.input,
        mode: saved.input.mode === "dish" ? "dish" : "ingredients",
        dishName: saved.input.dishName || defaultInput.dishName,
      });
      setStatus(saved.status === "planning" || saved.status === "replanning" ? "idle" : saved.status);
      setRecipes(saved.recipes);
      setSelectedRecipeId(saved.selectedRecipeId);
      setActiveRecipe(saved.activeRecipe);
      setCurrentStep(saved.currentStep);
      setCompletedStepIds(saved.completedStepIds);
      setTraces(saved.traces);
      setMode(saved.mode);
      if (saved.status === "planning" || saved.status === "replanning") {
        setNotice("检测到上次执行被中断，已恢复到可安全重新启动的状态。 ");
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const session: PersistedSession = {
      input,
      status,
      recipes,
      selectedRecipeId,
      activeRecipe,
      currentStep,
      completedStepIds,
      traces,
      mode,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, [hydrated, input, status, recipes, selectedRecipeId, activeRecipe, currentStep, completedStepIds, traces, mode]);

  useEffect(() => {
    const list = traceListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [traces]);

  const selectedRecipe = useMemo(
    () => recipes.find((recipe) => recipe.id === selectedRecipeId) ?? null,
    [recipes, selectedRecipeId],
  );

  const completedMinutes = useMemo(() => {
    if (!activeRecipe) return 0;
    return activeRecipe.steps
      .filter((step) => completedStepIds.includes(step.id))
      .reduce((sum, step) => sum + step.minutes, 0);
  }, [activeRecipe, completedStepIds]);

  const progress = activeRecipe ? Math.round((completedStepIds.length / activeRecipe.steps.length) * 100) : 0;
  const isBusy = status === "planning" || status === "replanning";

  async function revealServerTraces(events: TraceEvent[]) {
    for (const event of events) {
      setTraces((current) => [...current.filter((item) => item.status !== "running"), event]);
      await new Promise((resolve) => window.setTimeout(resolve, 110));
    }
  }

  async function runPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = input.mode === "dish" ? input.dishName : input.ingredients;
    if (!query.trim() || isBusy) return;
    setError(null);
    setNotice(null);
    setRecipes([]);
    setSelectedRecipeId(null);
    setActiveRecipe(null);
    setCurrentStep(0);
    setCompletedStepIds([]);
    setStatus("planning");
    setTraces([
      clientTrace("state", "启动 Agent run", "创建 run_id 与任务上下文。"),
      clientTrace("model", "生成候选计划", "等待结构化输出…", "running"),
    ]);

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as PlanResponse & { error?: string };
      if (!response.ok) {
        if (payload.traces) await revealServerTraces(payload.traces);
        throw new Error(payload.error || "规划失败，请检查输入后重试。");
      }

      setTraces([]);
      await revealServerTraces(payload.traces);
      setRecipes(payload.recipes);
      setSelectedRecipeId(payload.recipes[0]?.id ?? null);
      setMode(payload.mode);
      setNotice(payload.notice ?? null);
      setStatus("awaiting_approval");
    } catch (requestError) {
      setStatus("idle");
      setError(requestError instanceof Error ? requestError.message : "规划失败，请稍后重试。");
      setTraces((current) => [
        ...current.filter((item) => item.status !== "running"),
        clientTrace("state", "Run 已停止", "没有执行任何外部动作，可以安全重试。", "warning"),
      ]);
    }
  }

  function approvePlan() {
    if (!selectedRecipe) return;
    setActiveRecipe(selectedRecipe);
    setCurrentStep(0);
    setCompletedStepIds([]);
    setStatus("cooking");
    setTraces((current) => [
      ...current.map((item) =>
        item.status === "waiting" ? { ...item, status: "success" as const, detail: `用户批准“${selectedRecipe.name}”。` } : item,
      ),
      clientTrace("state", "进入执行模式", "已创建 cooking checkpoint。"),
    ]);
  }

  function completeCurrentStep() {
    if (!activeRecipe) return;
    const step = activeRecipe.steps[currentStep];
    if (!step) return;
    setCompletedStepIds((current) => (current.includes(step.id) ? current : [...current, step.id]));
    setTraces((current) => [
      ...current,
      clientTrace("state", `完成步骤 ${currentStep + 1}`, step.title),
    ]);

    if (currentStep >= activeRecipe.steps.length - 1) {
      setStatus("completed");
      setTraces((current) => [
        ...current,
        clientTrace("state", "任务完成", "执行结果与过程 Trace 已保存。"),
      ]);
      return;
    }
    setCurrentStep((value) => value + 1);
  }

  function goBackStep() {
    if (!activeRecipe || currentStep <= 0) return;
    const previous = activeRecipe.steps[currentStep - 1];
    setCompletedStepIds((current) => current.filter((id) => id !== previous.id));
    setCurrentStep((value) => Math.max(0, value - 1));
  }

  async function replan() {
    if (!activeRecipe || !issue.trim() || isBusy) return;
    setError(null);
    setNotice(null);
    setStatus("replanning");
    setTraces((current) => [
      ...current,
      clientTrace("state", "暂停执行", `在第 ${currentStep + 1} 步前建立 checkpoint。`),
      clientTrace("model", "局部重规划", "保留已完成步骤，正在修改后续计划…", "running"),
    ]);

    try {
      const response = await fetch("/api/replan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipe: activeRecipe,
          issue,
          allergens: input.allergens,
          maxMinutes: input.maxMinutes,
          currentStep,
        }),
      });
      const payload = (await response.json()) as ReplanResponse & { error?: string };
      if (!response.ok) {
        if (payload.traces) await revealServerTraces(payload.traces);
        throw new Error(payload.error || "重规划失败。");
      }

      await revealServerTraces(payload.traces);
      setActiveRecipe(payload.recipe);
      setMode(payload.mode);
      setNotice(payload.notice ?? `计划已调整，从第 ${currentStep + 1} 步继续。`);
      setStatus("cooking");
    } catch (requestError) {
      setStatus("cooking");
      setError(requestError instanceof Error ? requestError.message : "重规划失败，请重试。");
      setTraces((current) => [
        ...current.filter((item) => item.status !== "running"),
        clientTrace("state", "恢复原计划", "重规划失败，原 checkpoint 未被覆盖。", "warning"),
      ]);
    }
  }

  function resetDemo() {
    setInput(defaultInput);
    setStatus("idle");
    setRecipes([]);
    setSelectedRecipeId(null);
    setActiveRecipe(null);
    setCurrentStep(0);
    setCompletedStepIds([]);
    setTraces([]);
    setMode("mock");
    setNotice(null);
    setError(null);
    setIssue("没有鸡胸肉了，请帮我调整后面的步骤");
    localStorage.removeItem(STORAGE_KEY);
  }

  if (!hydrated) {
    return (
      <main className="boot-screen" aria-label="正在加载 Demo" ref={pageRef}>
        <LoaderCircle className="spin" size={24} />
        <span>恢复 Harness 状态…</span>
      </main>
    );
  }

  return (
    <main className="app-shell" ref={pageRef}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <CookingPot size={21} strokeWidth={2.2} />
          </div>
          <div>
            <div className="brand-name">开饭啦</div>
            <div className="brand-caption">AI KITCHEN HARNESS</div>
          </div>
        </div>

        <div className="nav-note" aria-hidden="true">PLAN · CHECK · APPROVE · COOK</div>

        <div className="topbar-actions">
          <div className={`runtime-badge mode-${mode}`} title="当前推理引擎">
            <span className="status-dot" />
            {mode === "openai" ? "Live model" : mode === "local" ? "Local RAG" : mode === "mock-fallback" ? "Fallback" : "Demo engine"}
          </div>
          <button className="button ghost compact" type="button" onClick={resetDemo}>
            <RotateCcw size={16} />
            重置 Demo
          </button>
        </div>
      </header>

      <section className="hero-strip" aria-labelledby="hero-title">
        <div className="hero-copy">
          <div className="eyebrow"><Zap size={15} /> 30 分钟，做一顿真的能完成的饭</div>
          <h1 id="hero-title">
            <span className="hero-line"><span className="hero-word">让</span><span className="hero-word">今晚的食材</span></span>
            <span className="hero-line"><span className="hero-word">变成</span><span className="inline-food-swatch" aria-hidden="true" /><span className="hero-word accent-word">一顿好饭</span></span>
          </h1>
          <p>不是再给你一张菜谱。Agent 会规划、校验、停下来等你确认，也会在缺料时从 checkpoint 接着改。</p>
          <a className="hero-cta" href="#agent-workbench"><Play size={18} fill="currentColor" /> 开始这顿饭</a>
        </div>

        <div className="hero-collage" aria-label="鸡胸肉、蔬菜与米饭组成的菜品拼贴">
          <div className="hero-photo-wrap" style={{ position: "absolute" }}>
            <Image
              className="hero-photo"
              src="/assets/hero-food-collage.png"
              alt="鸡胸肉、西兰花、胡萝卜、杏鲍菇与米饭组成的鲜亮拼盘"
              fill
              priority
              sizes="(max-width: 820px) 92vw, 48vw"
            />
          </div>
          <div className="hero-sticker sticker sticker-broccoli" aria-hidden="true" />
          <div className="hero-sticker sticker sticker-carrot" aria-hidden="true" />
          <div className="hero-sticker sticker sticker-robot" aria-hidden="true" />
          <div className="hero-scribble" aria-hidden="true">READY?</div>
        </div>
      </section>

      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          <span>PLAN IT</span><i /> <span>CHECK IT</span><i /> <span>APPROVE IT</span><i /> <span>COOK IT</span><i />
          <span>PLAN IT</span><i /> <span>CHECK IT</span><i /> <span>APPROVE IT</span><i /> <span>COOK IT</span><i />
        </div>
      </div>

      <div className="hero-stats" aria-label="Harness 能力摘要">
        <div><strong>04</strong><span>烹饪 Skills</span></div>
        <div><strong>01</strong><span>人工审批点</span></div>
        <div><strong>06</strong><span>运行状态</span></div>
        <div className="hero-stat-copy">模型可以灵活，边界必须清楚。</div>
      </div>

      {(notice || error) && (
        <div className={`notice ${error ? "notice-error" : ""}`} role={error ? "alert" : "status"}>
          {error ? <AlertTriangle size={18} /> : <Circle size={18} />}
          <span>{error ?? notice}</span>
          <button type="button" aria-label="关闭提示" onClick={() => (error ? setError(null) : setNotice(null))}>
            <X size={16} />
          </button>
        </div>
      )}

      <div className="mobile-tabs" aria-label="移动端面板切换">
        <button className={!showTraceOnMobile ? "active" : ""} onClick={() => setShowTraceOnMobile(false)} type="button">
          <Utensils size={16} /> 工作台
        </button>
        <button className={showTraceOnMobile ? "active" : ""} onClick={() => setShowTraceOnMobile(true)} type="button">
          <TerminalSquare size={16} /> Trace <span>{traces.length}</span>
        </button>
      </div>

      <div id="agent-workbench" className={`workspace ${showTraceOnMobile ? "show-mobile-trace" : ""}`}>
        <aside className="panel input-panel">
          <div className="panel-heading">
            <div>
              <span className="step-label">你的厨房</span>
              <h2>今天有什么？</h2>
            </div>
            <LockKeyhole size={18} aria-label="输入仅用于本次规划" />
          </div>

          <form onSubmit={runPlan} className="task-form">
            <div className="mode-switch" role="radiogroup" aria-label="菜谱输入模式">
              <button
                type="button"
                role="radio"
                aria-checked={input.mode === "dish"}
                className={input.mode === "dish" ? "active" : ""}
                onClick={() => setInput((current) => ({ ...current, mode: "dish" }))}
                disabled={isBusy}
              >
                <ChefHat size={16} /> 按菜名查做法
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={input.mode === "ingredients"}
                className={input.mode === "ingredients" ? "active" : ""}
                onClick={() => setInput((current) => ({ ...current, mode: "ingredients" }))}
                disabled={isBusy}
              >
                <Utensils size={16} /> 按食材找灵感
              </button>
            </div>

            {input.mode === "dish" ? (
              <label className="field mode-field">
                <span>想做哪道菜？</span>
                <input
                  value={input.dishName}
                  onChange={(event) => setInput((current) => ({ ...current, dishName: event.target.value }))}
                  placeholder="例如：佛跳墙、丝瓜鸡蛋汤"
                  disabled={isBusy}
                  autoFocus
                />
                <small>会先查本地可信菜谱；复杂菜不会被强行压成 30 分钟。</small>
              </label>
            ) : (
              <label className="field mode-field">
                <span>现有食材</span>
                <textarea
                  value={input.ingredients}
                  onChange={(event) => setInput((current) => ({ ...current, ingredients: event.target.value }))}
                  placeholder="例如：鸡胸肉、西兰花、胡萝卜"
                  rows={4}
                  disabled={isBusy}
                />
                <small>用逗号分隔，系统会优先返回不同烹饪技法。</small>
              </label>
            )}

            <label className="field">
              <span>口味偏好</span>
              <input
                value={input.taste}
                onChange={(event) => setInput((current) => ({ ...current, taste: event.target.value }))}
                placeholder="少油、清淡、不辣"
                disabled={isBusy}
              />
            </label>

            <label className="field">
              <span>过敏原 / 绝对禁忌</span>
              <input
                value={input.allergens}
                onChange={(event) => setInput((current) => ({ ...current, allergens: event.target.value }))}
                placeholder="例如：花生、牛奶"
                disabled={isBusy}
              />
              <small>这是硬约束，会经过确定性工具二次检查。</small>
            </label>

            <div className="field-row">
              <label className="field">
                <span>人数</span>
                <select
                  value={input.servings}
                  onChange={(event) => setInput((current) => ({ ...current, servings: Number(event.target.value) }))}
                  disabled={isBusy}
                >
                  {[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value} 人</option>)}
                </select>
              </label>
              <label className="field">
                <span>时间上限</span>
                <select
                  value={input.maxMinutes}
                  onChange={(event) => setInput((current) => ({ ...current, maxMinutes: Number(event.target.value) }))}
                  disabled={isBusy}
                >
                {[20, 30, 45, 60, 120, 240].map((value) => <option key={value} value={value}>{value} 分钟</option>)}
                </select>
              </label>
            </div>

            <button className="button primary full" type="submit" disabled={isBusy || !(input.mode === "dish" ? input.dishName : input.ingredients).trim()}>
              {status === "planning" ? <LoaderCircle className="spin" size={18} /> : <Play size={18} fill="currentColor" />}
              {status === "planning" ? "Agent 正在规划" : recipes.length ? "重新生成方案" : "启动 Agent"}
            </button>
          </form>

          <div className="boundary-card">
            <ShieldCheck size={18} />
            <div>
              <strong>执行边界</strong>
              <p>Demo 不会下单或写入外部系统。选择食谱后仍需人工确认，密钥只在服务端读取。</p>
            </div>
          </div>
        </aside>

        <section className="panel main-panel" aria-live="polite">
          <div className="panel-heading main-heading">
            <div>
              <span className="step-label">Agent 工作台</span>
              <h2>{statusMeta[status].label}</h2>
            </div>
            <div className={`state-chip state-${status}`}>
              {isBusy && <LoaderCircle className="spin" size={14} />}
              {statusMeta[status].description}
            </div>
          </div>

          {status === "idle" && recipes.length === 0 && (
            <div className="empty-stage">
              <div className="empty-visual" aria-hidden="true">
                <ChefHat size={36} />
                <div className="orbit orbit-one"><Code2 size={14} /></div>
                <div className="orbit orbit-two"><Wrench size={14} /></div>
                <div className="orbit orbit-three"><ShieldCheck size={14} /></div>
              </div>
              <h3>准备创建一条可观察的 Agent Run</h3>
              <p>左侧已经放入一组示例食材。点击“启动 Agent”，观察生成、工具校验和人工审批如何连接起来。</p>
              <div className="capability-list">
                <span><Check size={14} /> Structured output</span>
                <span><Check size={14} /> Deterministic tools</span>
                <span><Check size={14} /> Checkpoint & resume</span>
              </div>
            </div>
          )}

          {status === "planning" && (
            <div className="planning-stage">
              <div className="planning-loader">
                <div className="pulse-ring"><Sparkles size={28} /></div>
              </div>
              <h3>正在组合一份可执行计划</h3>
              <p>Agent 会先生成候选，再把每一套方案交给时间与过敏原工具校验。</p>
              <div className="skeleton-lines" aria-hidden="true"><i /><i /><i /></div>
            </div>
          )}

          {recipes.length > 0 && status === "awaiting_approval" && (
            <div className="proposal-stage">
              <div className="section-intro">
                <div>
                  <span className="section-kicker">{recipes.length > 1 ? "多份可信选择" : "本地可信做法"}</span>
                  <h3>{recipes.length > 1 ? "挑一份，再让 Agent 开工" : "检查约束，再让 Agent 开工"}</h3>
                </div>
                <div className="approval-pill"><UserCheck size={15} /> Human-in-the-loop</div>
              </div>

              <div className="recipe-grid">
                {recipes.map((recipe, index) => {
                  const selected = selectedRecipeId === recipe.id;
                  return (
                    <button
                      className={`recipe-card ${selected ? "selected" : ""}`}
                      key={recipe.id}
                      type="button"
                      onClick={() => setSelectedRecipeId(recipe.id)}
                      aria-pressed={selected}
                    >
                      <div className="recipe-card-top">
                        <span className="option-label">方案 {String.fromCharCode(65 + index)}</span>
                        <span className={`select-indicator ${selected ? "selected" : ""}`}>
                          {selected ? <Check size={14} /> : null}
                        </span>
                      </div>
                      <h4>{recipe.name}</h4>
                      <p>{recipe.description}</p>
                      {recipe.feasibility && !recipe.feasibility.fitsTime && (
                        <div className="feasibility-warning"><AlertTriangle size={15} /> {recipe.feasibility.message}</div>
                      )}
                      <div className="recipe-metrics">
                        <span><Clock3 size={15} /> {recipe.totalMinutes} 分钟</span>
                        <span><Utensils size={15} /> {recipe.servings} 人份</span>
                      </div>
                      {(recipe.technique || recipe.difficulty || recipe.activeMinutes) && (
                        <div className="recipe-facts">
                          {recipe.technique && <span>技法 · {recipe.technique}</span>}
                          {recipe.difficulty && <span>难度 · {recipe.difficulty}</span>}
                          {recipe.activeMinutes && <span>动手 · {recipe.activeMinutes} 分钟</span>}
                        </div>
                      )}
                      <div className="tag-row">{recipe.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                      <div className="rationale"><Sparkles size={14} /><span>{recipe.rationale}</span></div>
                      {recipe.source && <div className="source-note">来源：{recipe.source.title} · {recipe.source.license}</div>}
                    </button>
                  );
                })}
              </div>

              {selectedRecipe && (
                <div className="approval-bar">
                  <div>
                    <span>即将执行</span>
                    <strong>{selectedRecipe.name}</strong>
                  </div>
                  <button className="button approve" type="button" onClick={approvePlan}>
                    <ShieldCheck size={18} /> 确认并开始
                  </button>
                </div>
              )}
            </div>
          )}

          {activeRecipe && (status === "cooking" || status === "replanning" || status === "completed") && (
            <div className="cooking-stage">
              <div className="cooking-header">
                <div>
                  <span className="section-kicker">正在做这道菜</span>
                  <h3>{activeRecipe.name}</h3>
                  <p>{activeRecipe.description}</p>
                </div>
                <div className="progress-ring" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}>
                  <strong>{progress}%</strong><span>完成</span>
                </div>
              </div>

              <div className="progress-track" aria-label={`烹饪进度 ${progress}%`}>
                <span style={{ width: `${progress}%` }} />
              </div>
              <div className="progress-meta">
                <span>{completedStepIds.length} / {activeRecipe.steps.length} 步</span>
                <span>已执行约 {completedMinutes} 分钟</span>
              </div>

              <div className="step-list">
                {activeRecipe.steps.map((step, index) => {
                  const done = completedStepIds.includes(step.id);
                  const active = index === currentStep && status !== "completed";
                  return (
                    <div className={`cooking-step ${done ? "done" : ""} ${active ? "active" : ""}`} key={step.id}>
                      <div className="step-number">{done ? <Check size={16} /> : index + 1}</div>
                      <div className="step-content">
                        <div className="step-title-row">
                          <h4>{step.title}</h4>
                          <span><Clock3 size={14} /> {step.minutes} 分钟</span>
                        </div>
                        <p>{step.instruction}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {status !== "completed" ? (
                <>
                  <div className="cooking-controls">
                    <button className="button secondary" type="button" onClick={goBackStep} disabled={currentStep === 0 || status === "replanning"}>
                      <ArrowLeft size={17} /> 上一步
                    </button>
                    <button className="button primary" type="button" onClick={completeCurrentStep} disabled={status === "replanning"}>
                      {currentStep === activeRecipe.steps.length - 1 ? <CheckCircle2 size={18} /> : <ArrowRight size={18} />}
                      {currentStep === activeRecipe.steps.length - 1 ? "完成这顿饭" : "完成并继续"}
                    </button>
                  </div>

                  <div className="replan-box">
                    <div className="replan-heading">
                      <div><TimerReset size={18} /><strong>计划有变？从当前 checkpoint 调整</strong></div>
                      <span>不会修改已完成步骤</span>
                    </div>
                    <div className="replan-input-row">
                      <label className="sr-only" htmlFor="replan-issue">描述遇到的问题</label>
                      <input
                        id="replan-issue"
                        value={issue}
                        onChange={(event) => setIssue(event.target.value)}
                        disabled={status === "replanning"}
                        placeholder="例如：没有鸡胸肉了"
                      />
                      <button className="button secondary" type="button" onClick={replan} disabled={status === "replanning" || !issue.trim()}>
                        {status === "replanning" ? <LoaderCircle className="spin" size={17} /> : <RefreshCcw size={17} />}
                        {status === "replanning" ? "重规划中" : "调整后续步骤"}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="completion-card">
                  <div className="completion-icon"><CheckCircle2 size={30} /></div>
                  <div>
                    <span>任务完成</span>
                    <h3>一顿饭完成，Harness 闭环已记录</h3>
                    <p>你可以在右侧查看从规划、工具校验、审批、执行到完成的完整 Trace。</p>
                  </div>
                  <button className="button secondary" type="button" onClick={resetDemo}><RotateCcw size={17} /> 再演示一次</button>
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="panel trace-panel">
          <div className="panel-heading trace-heading">
            <div>
              <span className="step-label">运行实况</span>
              <h2>Agent Trace</h2>
            </div>
            <span className="event-count">{traces.length} events</span>
          </div>

          <div className="runtime-state-card">
            <div className="runtime-state-top">
              <span>当前状态</span>
              <strong>{status.toUpperCase()}</strong>
            </div>
            <div className="state-flow">
              {stateOrder.map((item, index) => {
                const currentIndex = stateIndex(status);
                const complete = index < currentIndex || status === "completed";
                const active = index === currentIndex && status !== "completed";
                return (
                  <div className={`state-node ${complete ? "complete" : ""} ${active ? "active" : ""}`} key={item.key}>
                    <span>{complete ? <Check size={12} /> : active ? <LoaderCircle className={isBusy ? "spin" : ""} size={12} /> : null}</span>
                    <small>{item.label}</small>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="trace-toolbar">
            <span><TerminalSquare size={15} /> Timeline</span>
            <span>实时</span>
          </div>

          <div className="trace-list" ref={traceListRef}>
            {traces.length === 0 ? (
              <div className="trace-empty">
                <Code2 size={22} />
                <p>Agent 启动后，模型、工具、审批和状态事件会显示在这里。</p>
              </div>
            ) : (
              traces.map((event, index) => {
                const Icon = traceIcons[event.kind];
                return (
                  <article className={`trace-event trace-${event.status}`} key={event.id}>
                    <div className="trace-rail">
                      <div className="trace-icon">
                        {event.status === "running" ? <LoaderCircle className="spin" size={15} /> : <Icon size={15} />}
                      </div>
                      {index < traces.length - 1 && <i />}
                    </div>
                    <div className="trace-body">
                      <div className="trace-meta">
                        <span>{event.kind}</span>
                        <time>{formatClock(event.createdAt)}</time>
                      </div>
                      <h3>{event.label}</h3>
                      <p>{event.detail}</p>
                      {typeof event.durationMs === "number" && <small>{event.durationMs} ms</small>}
                    </div>
                  </article>
                );
              })
            )}
          </div>

          <div className="trace-footer">
            <Gauge size={16} />
            <div><strong>Context persisted</strong><span>刷新页面后可从最近状态恢复</span></div>
          </div>
        </aside>
      </div>

      <footer className="playful-footer">
        <div className="footer-sticker sticker sticker-pan" aria-hidden="true" />
        <p>HARNESS DEMO LITE · BUILT FOR THE REAL KITCHEN</p>
        <h2>让 Agent 去计划，<br />你只负责开饭。</h2>
        <button className="footer-action" type="button" onClick={resetDemo}>
          <RefreshCcw size={20} /> 再跑一次完整流程
        </button>
      </footer>
    </main>
  );
}
