"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import Image from "next/image";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
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
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  UserCheck,
  Utensils,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { PersistedSession, PlanInput, PlanOption, PlanResponse, RunStatus, TraceEvent, TraceKind } from "@/lib/types";

gsap.registerPlugin(useGSAP);

const STORAGE_KEY = "kaifan-harness-demo-v5";

const defaultInput: PlanInput = {
  mode: "ingredients",
  dishName: "丝瓜鸡蛋汤",
  ingredients: "鸡腿、土豆",
  unavailableSeasonings: "",
  planScope: "single",
  dishCount: 1,
  taste: "少油、咸鲜、不辣",
  allergens: "花生",
  servings: 2,
  maxMinutes: 60,
};

const statusMeta: Record<RunStatus, { label: string; description: string }> = {
  idle: { label: "等待任务", description: "填写库存并启动 Agent" },
  planning: { label: "检索规划中", description: "正在检索、排序与校验" },
  awaiting_approval: { label: "等待审批", description: "Agent 已暂停，等待你选择方案" },
  cooking: { label: "做饭中", description: "所有步骤一次查看，完成后统一确认" },
  completed: { label: "已完成", description: "本次做饭任务已闭环" },
};

const traceIcons: Record<TraceKind, typeof Wrench> = {
  state: GitBranch,
  tool: Wrench,
  planner: Sparkles,
  approval: UserCheck,
  guardrail: ShieldCheck,
};

const stateOrder: Array<{ key: RunStatus; label: string }> = [
  { key: "idle", label: "任务输入" },
  { key: "planning", label: "检索与校验" },
  { key: "awaiting_approval", label: "人工确认" },
  { key: "cooking", label: "查看做法" },
  { key: "completed", label: "完成" },
];

function clientTrace(kind: TraceKind, label: string, detail: string, status: TraceEvent["status"] = "success"): TraceEvent {
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
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const session = JSON.parse(value) as PersistedSession;
    return session.version === 5 ? session : null;
  } catch {
    return null;
  }
}

export default function Home() {
  const pageRef = useRef<HTMLElement>(null);
  const traceListRef = useRef<HTMLDivElement>(null);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState<PlanInput>(defaultInput);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [activePlan, setActivePlan] = useState<PlanOption | null>(null);
  const [traces, setTraces] = useState<TraceEvent[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTraceOnMobile, setShowTraceOnMobile] = useState(false);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  );
  const isBusy = status === "planning";
  const usesDeepSeek = plans.some((plan) => plan.recipes.some((recipe) => recipe.source.kind === "deepseek"));
  const currentStateIndex = stateOrder.findIndex((item) => item.key === status);

  useGSAP(() => {
    if (!hydrated) return;
    const media = gsap.matchMedia();
    media.add({ desktop: "(min-width: 821px)", reduceMotion: "(prefers-reduced-motion: reduce)" }, (context) => {
      const { desktop, reduceMotion } = context.conditions as { desktop: boolean; reduceMotion: boolean };
      if (reduceMotion) return;
      gsap.from(".hero-word", { yPercent: 110, rotation: 2, autoAlpha: 0, duration: 0.75, ease: "power3.out", stagger: 0.07 });
      gsap.from(".hero-collage", { scale: 0.82, rotation: desktop ? 5 : 0, autoAlpha: 0, duration: 0.9, ease: "back.out(1.35)", delay: 0.12 });
      gsap.from(".hero-sticker", { scale: 0, rotation: (index) => (index % 2 ? 14 : -14), duration: 0.6, stagger: 0.08, ease: "back.out(1.8)", delay: 0.45 });
    });
    return () => media.revert();
  }, { scope: pageRef, dependencies: [hydrated], revertOnUpdate: true });

  useGSAP(() => {
    if (!hydrated || status !== "awaiting_approval") return;
    gsap.from(".recipe-card", { y: 56, rotation: (index) => (index % 2 ? 2.5 : -2.5), autoAlpha: 0, duration: 0.55, stagger: 0.1, ease: "power3.out" });
  }, { scope: pageRef, dependencies: [hydrated, status, plans.length], revertOnUpdate: true });

  useEffect(() => {
    const saved = safeReadSession();
    if (saved) {
      setInput({ ...defaultInput, ...saved.input });
      setStatus(saved.status === "planning" ? "idle" : saved.status);
      setPlans(saved.plans);
      setSelectedPlanId(saved.selectedPlanId);
      setActivePlan(saved.activePlan);
      // An idle session can only be an interrupted/failed run. Do not restore
      // its old timeline beside an empty workbench after a refresh.
      setTraces(saved.status === "idle" && saved.plans.length === 0 && !saved.activePlan ? [] : saved.traces);
      if (saved.status === "planning") setNotice("上次检索被中断，已安全恢复到可重试状态。");
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const session: PersistedSession = { version: 5, input, status, plans, selectedPlanId, activePlan, traces };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, [hydrated, input, status, plans, selectedPlanId, activePlan, traces]);

  useEffect(() => {
    if (traceListRef.current) traceListRef.current.scrollTop = traceListRef.current.scrollHeight;
  }, [traces]);

  async function revealServerTraces(events: TraceEvent[]) {
    for (const event of events) {
      setTraces((current) => [...current.filter((item) => item.status !== "running"), event]);
      await new Promise((resolve) => window.setTimeout(resolve, 90));
    }
  }

  async function runPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = input.mode === "dish" ? input.dishName : input.ingredients;
    if (!query.trim() || isBusy) return;
    setError(null);
    setNotice(null);
    setPlans([]);
    setSelectedPlanId(null);
    setActivePlan(null);
    setStatus("planning");
    setTraces([
      clientTrace("state", "启动可信规划 Run", "创建本次任务上下文。"),
      clientTrace("tool", "等待本地检索", "准备读取可信菜谱索引…", "running"),
    ]);

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as PlanResponse & { error?: string };
      setTraces([]);
      if (payload.traces) await revealServerTraces(payload.traces);
      if (!response.ok) throw new Error(payload.error || "规划失败，请调整库存后重试。");
      setPlans(payload.plans);
      setSelectedPlanId(payload.plans[0]?.id ?? null);
      setNotice(payload.notice ?? null);
      setStatus("awaiting_approval");
    } catch (requestError) {
      setStatus("idle");
      setError(requestError instanceof Error ? requestError.message : "规划失败，请稍后重试。");
      setTraces((current) => [...current.filter((item) => item.status !== "running"), clientTrace("state", "Run 已停止", "没有执行任何外部动作，可以安全修改库存后重试。", "warning")]);
    }
  }

  function approvePlan() {
    if (!selectedPlan) return;
    setActivePlan(selectedPlan);
    setStatus("cooking");
    setTraces((current) => [
      ...current.map((item) => item.status === "waiting" ? { ...item, status: "success" as const, detail: `用户批准“${selectedPlan.title}”。` } : item),
      clientTrace("state", "展示完整做法", `一次展开 ${selectedPlan.recipes.length} 道菜的全部步骤。`),
    ]);
  }

  function completeMeal() {
    if (!activePlan) return;
    setStatus("completed");
    setTraces((current) => [...current, clientTrace("state", "整顿饭已确认完成", `“${activePlan.title}”完成；本次 Harness Run 闭环。`)]);
  }

  function resetDemo() {
    setInput(defaultInput);
    setStatus("idle");
    setPlans([]);
    setSelectedPlanId(null);
    setActivePlan(null);
    setTraces([]);
    setNotice(null);
    setError(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  if (!hydrated) {
    return <main className="boot-screen" aria-label="正在加载 Demo" ref={pageRef}><LoaderCircle className="spin" size={24} /><span>恢复 Harness 状态…</span></main>;
  }

  return (
    <main className="app-shell" ref={pageRef}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><CookingPot size={21} strokeWidth={2.2} /></div>
          <div><div className="brand-name">开饭啦</div><div className="brand-caption">AI KITCHEN HARNESS</div></div>
        </div>
          <div className="nav-note" aria-hidden="true">GENERATE · CHECK · REPAIR · APPROVE</div>
        <div className="topbar-actions">
          <div className={`runtime-badge ${usesDeepSeek ? "mode-deepseek" : "mode-local"}`} title="当前规划引擎"><span className="status-dot" />{usesDeepSeek ? "DeepSeek + Guardrails" : plans.length ? "Local fallback" : "Hybrid ready"}</div>
          <button className="button ghost compact" type="button" onClick={resetDemo}><RotateCcw size={16} />重置 Demo</button>
        </div>
      </header>

      <section className="hero-strip" aria-labelledby="hero-title">
        <div className="hero-copy">
          <div className="eyebrow"><Zap size={15} /> 用冰箱现有食材，做一顿正常的饭</div>
          <h1 id="hero-title">
            <span className="hero-line"><span className="hero-word">让</span><span className="hero-word">今晚的食材</span></span>
            <span className="hero-line"><span className="hero-word">变成</span><span className="inline-food-swatch" aria-hidden="true" /><span className="hero-word accent-word">一顿好饭</span></span>
          </h1>
          <p>默认尝试用一道真实菜解决全部库存；食材较多时切换多道菜分开消耗，Agent 会在零新增校验后等你确认。</p>
          <a className="hero-cta" href="#agent-workbench"><Play size={18} fill="currentColor" />看看今晚吃什么</a>
        </div>
        <div className="hero-collage" aria-label="鲜亮的家常菜食材拼贴">
          <div className="hero-photo-wrap" style={{ position: "absolute" }}>
            <Image className="hero-photo" src="/assets/hero-food-collage.png" alt="鸡肉、蔬菜与米饭组成的鲜亮拼盘" fill priority sizes="(max-width: 820px) 92vw, 48vw" />
          </div>
          <div className="hero-sticker sticker sticker-broccoli" aria-hidden="true" />
          <div className="hero-sticker sticker sticker-carrot" aria-hidden="true" />
          <div className="hero-sticker sticker sticker-robot" aria-hidden="true" />
          <div className="hero-scribble" aria-hidden="true">READY?</div>
        </div>
      </section>

      <div className="marquee" aria-hidden="true"><div className="marquee-track">
        <span>RETRIEVE IT</span><i /><span>RANK IT</span><i /><span>CHECK IT</span><i /><span>COOK IT</span><i />
        <span>RETRIEVE IT</span><i /><span>RANK IT</span><i /><span>CHECK IT</span><i /><span>COOK IT</span><i />
      </div></div>

      <div className="hero-stats" aria-label="Harness 能力摘要">
        <div><strong>05</strong><span>生成与校验 Skills</span></div>
        <div><strong>01</strong><span>人工审批点</span></div>
        <div><strong>05</strong><span>运行状态</span></div>
        <div className="hero-stat-copy">默认备好油盐酱醋，把填写留给真正重要的食材。</div>
      </div>

      {(notice || error) && (
        <div className={`notice ${error ? "notice-error" : ""}`} role={error ? "alert" : "status"}>
          {error ? <AlertTriangle size={18} /> : <Circle size={18} />}<span>{error ?? notice}</span>
          <button type="button" aria-label="关闭提示" onClick={() => error ? setError(null) : setNotice(null)}><X size={16} /></button>
        </div>
      )}

      <div className="mobile-tabs" aria-label="移动端面板切换">
        <button className={!showTraceOnMobile ? "active" : ""} onClick={() => setShowTraceOnMobile(false)} type="button"><Utensils size={16} />工作台</button>
        <button className={showTraceOnMobile ? "active" : ""} onClick={() => setShowTraceOnMobile(true)} type="button"><TerminalSquare size={16} />Trace <span>{traces.length}</span></button>
      </div>

      <div id="agent-workbench" className={`workspace ${showTraceOnMobile ? "show-mobile-trace" : ""}`}>
        <aside className="panel input-panel">
          <div className="panel-heading"><div><span className="step-label">你的厨房</span><h2>今天有什么？</h2></div><LockKeyhole size={18} aria-label="输入仅用于本次规划" /></div>
          <form onSubmit={runPlan} className="task-form">
            <div className="mode-switch" role="radiogroup" aria-label="菜谱输入模式">
              <button type="button" role="radio" aria-checked={input.mode === "dish"} className={input.mode === "dish" ? "active" : ""} onClick={() => setInput((current) => ({ ...current, mode: "dish" }))} disabled={isBusy}><ChefHat size={16} />按菜名查做法</button>
              <button type="button" role="radio" aria-checked={input.mode === "ingredients"} className={input.mode === "ingredients" ? "active" : ""} onClick={() => setInput((current) => ({ ...current, mode: "ingredients" }))} disabled={isBusy}><Utensils size={16} />按食材找灵感</button>
            </div>

            {input.mode === "dish" ? (
              <label className="field mode-field"><span>想做哪道菜？</span><input value={input.dishName} onChange={(event) => setInput((current) => ({ ...current, dishName: event.target.value }))} placeholder="例如：佛跳墙、丝瓜鸡蛋汤" disabled={isBusy} /><small>只返回本地可信完整菜谱；复杂菜不会被强行压成快手菜。</small></label>
            ) : (
              <div className="ingredient-mode-fields mode-field">
                <label className="field"><span>冰箱里有这些</span><textarea value={input.ingredients} onChange={(event) => setInput((current) => ({ ...current, ingredients: event.target.value }))} placeholder="例如：鸡腿、土豆、青菜、米饭" rows={4} disabled={isBusy} /><small>把想解决的主要食材都写上；默认会尝试一锅解决全部库存。</small></label>
                <fieldset className="inventory-rules">
                  <legend>今晚做几道菜？</legend>
                  <div className="scope-switch" role="radiogroup" aria-label="规划方式">
                    <button type="button" role="radio" aria-checked={input.planScope === "single"} className={input.planScope === "single" ? "active" : ""} onClick={() => setInput((current) => ({ ...current, planScope: "single", dishCount: 1 }))} disabled={isBusy}>一道菜 · 全部食材</button>
                    <button type="button" role="radio" aria-checked={input.planScope === "meal"} className={input.planScope === "meal" ? "active" : ""} onClick={() => setInput((current) => ({ ...current, planScope: "meal", dishCount: Math.max(2, current.dishCount) }))} disabled={isBusy}>多道菜 · 分开消耗</button>
                  </div>
                  {input.planScope === "meal" && <label className="field dish-count-field"><span>这顿想做几道菜？</span><select value={input.dishCount} onChange={(event) => setInput((current) => ({ ...current, dishCount: Number(event.target.value) }))} disabled={isBusy}>{[2, 3, 4].map((value) => <option key={value} value={value}>{value} 道菜</option>)}</select><small>多道菜会合计覆盖你填写的主要食材，不会重复同一道菜。</small></label>}
                  <div className="zero-purchase-lock" role="status"><LockKeyhole size={16} /><span><strong>库存闭环</strong> 单菜默认覆盖全部食材；多菜模式会把食材拆到不同真实菜谱中。</span></div>
                </fieldset>
              </div>
            )}

            <details className="seasoning-settings">
              <summary>
                <span className="seasoning-summary-icon" aria-hidden="true"><Settings2 size={16} /></span>
                <span><strong>其他要求（可选）</strong><small>口味、过敏原和调料例外</small></span>
                <ChevronDown className="seasoning-chevron" size={17} aria-hidden="true" />
              </summary>
              <div className="seasoning-settings-body">
                <label className="field"><span>口味偏好</span><input value={input.taste} onChange={(event) => setInput((current) => ({ ...current, taste: event.target.value }))} placeholder="例如：少油、清淡、不辣" disabled={isBusy} /></label>
                <label className="field"><span>过敏原 / 绝对禁忌</span><input value={input.allergens} onChange={(event) => setInput((current) => ({ ...current, allergens: event.target.value }))} placeholder="例如：花生、牛奶" disabled={isBusy} /><small>这是硬约束，会经过确定性工具二次检查。</small></label>
                <label className="field"><span>家里没有这些调料</span><input value={input.unavailableSeasonings} onChange={(event) => setInput((current) => ({ ...current, unavailableSeasonings: event.target.value }))} placeholder="例如：蚝油、豆瓣酱（可不填）" disabled={isBusy} /><small>油、盐、糖、生抽等基础调料默认家里有。</small></label>
              </div>
            </details>
            <div className="field-row">
              <label className="field"><span>人数</span><select value={input.servings} onChange={(event) => setInput((current) => ({ ...current, servings: Number(event.target.value) }))} disabled={isBusy}>{[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value} 人</option>)}</select></label>
              <label className="field"><span>时间预算</span><select value={input.maxMinutes} onChange={(event) => setInput((current) => ({ ...current, maxMinutes: Number(event.target.value) }))} disabled={isBusy}>{[20, 30, 45, 60, 90, 120, 240].map((value) => <option key={value} value={value}>{value} 分钟</option>)}</select></label>
            </div>
            <button className="button primary full" type="submit" disabled={isBusy || !(input.mode === "dish" ? input.dishName : input.ingredients).trim()}>{isBusy ? <LoaderCircle className="spin" size={18} /> : <Play size={18} fill="currentColor" />}{isBusy ? "正在生成并校验" : plans.length ? "重新规划一餐" : "启动 Agent"}</button>
          </form>
          <div className="boundary-card"><ShieldCheck size={18} /><div><strong>执行边界</strong><p>Demo 不会下单或写入外部系统；只会展示真实菜谱，并在开始前等待人工确认。</p></div></div>
        </aside>

        <section className="panel main-panel" aria-live="polite">
          <div className="panel-heading main-heading"><div><span className="step-label">Agent 工作台</span><h2>{statusMeta[status].label}</h2></div><div className={`state-chip state-${status}`}>{isBusy && <LoaderCircle className="spin" size={14} />}{statusMeta[status].description}</div></div>

          {status === "idle" && plans.length === 0 && (
            <div className="empty-stage"><div className="empty-visual" aria-hidden="true"><ChefHat size={36} /><div className="orbit orbit-one"><Code2 size={14} /></div><div className="orbit orbit-two"><Wrench size={14} /></div><div className="orbit orbit-three"><ShieldCheck size={14} /></div></div><h3>从真实菜谱中找一顿正常的饭</h3><p>填写库存后，Agent 会先找完整菜谱，再判断哪些不缺主要食材，最后组合主菜、配菜或汤。</p><div className="capability-list"><span><Check size={14} />可信来源</span><span><Check size={14} />主食材闭包</span><span><Check size={14} />一餐组合</span></div></div>
          )}

          {status === "planning" && (
            <div className="planning-stage"><div className="planning-loader"><div className="pulse-ring"><Sparkles size={28} /></div></div><h3>正在规划一顿真实可做的饭</h3><p>DeepSeek 生成候选，本地程序检查库存、过敏原、时间、数量与方案重复度。</p><div className="skeleton-lines" aria-hidden="true"><i /><i /><i /></div></div>
          )}

          {plans.length > 0 && status === "awaiting_approval" && (
            <div className="proposal-stage">
              <div className="section-intro"><div><span className="section-kicker">{plans.length > 1 ? "多份可信选择" : "一份可信选择"}</span><h3>挑一顿，再让 Agent 开工</h3></div><div className="approval-pill"><UserCheck size={15} />Human-in-the-loop</div></div>
              <div className="recipe-grid">
                {plans.map((plan, index) => {
                  const selected = selectedPlanId === plan.id;
                  return (
                    <button className={`recipe-card ${selected ? "selected" : ""}`} key={plan.id} type="button" onClick={() => setSelectedPlanId(plan.id)} aria-pressed={selected}>
                      <div className="recipe-card-top"><span className="option-label">方案 {String.fromCharCode(65 + index)}</span><span className={`select-indicator ${selected ? "selected" : ""}`}>{selected ? <Check size={14} /> : null}</span></div>
                      <h4>{plan.title}</h4><p>{plan.description}</p>
                      {!plan.fitsTime && <div className="feasibility-warning"><AlertTriangle size={15} />{plan.timeMessage}</div>}
                      <div className="recipe-metrics"><span><Clock3 size={15} />约 {plan.totalMinutes} 分钟</span><span><Utensils size={15} />{plan.servings} 人份</span></div>
                      <div className="plan-recipe-list">{plan.recipes.map((recipe) => <div key={recipe.id}><strong>{recipe.name}</strong><span>{recipe.technique} · {recipe.source.kind === "gold" ? "手工校验" : recipe.source.kind === "deepseek" ? "DeepSeek 生成" : "HowToCook"}</span></div>)}</div>
                      {input.mode === "ingredients" ? <><div className="inventory-proof" aria-label="库存适配结果"><span className={plan.coverage.unused.length ? "inventory-proof-warning" : "inventory-proof-ok"}><CheckCircle2 size={14} />{plan.coverage.unused.length ? `已使用 ${plan.coverage.used.length} 种，未覆盖 ${plan.coverage.unused.length} 种` : `主要食材 ${plan.coverage.used.length} 种全部覆盖`}</span><span className="inventory-proof-ok">新增主食材 0</span><small>默认调料：{plan.coverage.pantryUsed.join("、") || "无"}</small>{plan.coverage.specialtySeasonings.length > 0 && <small className="seasoning-warning"><AlertTriangle size={13} />可能需要特殊调料：{plan.coverage.specialtySeasonings.join("、")}</small>}</div>{plan.coverage.unused.length > 0 && <div className="unused-note">未覆盖食材：{plan.coverage.unused.join("、")}；建议切换多道菜</div>}</> : <div className="source-note">来源：{plan.recipes[0].source.title} · {plan.recipes[0].source.license}</div>}
                      <div className="tag-row">{plan.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                      <div className="rationale"><Sparkles size={14} /><span>{plan.rationale}</span></div>
                    </button>
                  );
                })}
              </div>
              {selectedPlan && <div className="approval-bar"><div><span>即将执行</span><strong>{selectedPlan.title}</strong></div><button className="button approve" type="button" onClick={approvePlan}><ShieldCheck size={18} />确认并开始</button></div>}
            </div>
          )}

          {activePlan && (status === "cooking" || status === "completed") && (
            <div className="cooking-stage">
              <div className="cooking-header"><div><span className="section-kicker">{status === "completed" ? "今晚吃得不错" : "正在做这顿饭"}</span><h3>{activePlan.title}</h3><p>{activePlan.description}</p></div>{status === "completed" && <div className="completion-icon"><CheckCircle2 size={30} /></div>}</div>
              {status === "cooking" && (
                <>
                  <div className="all-steps-note"><Circle size={15} /><span>做饭时不用逐步打卡。全部步骤已展开，看完后只需在底部确认一次。</span></div>
                  <div className="meal-step-list">
                    {activePlan.recipes.map((recipe) => (
                      <section className="cooking-recipe-group" key={recipe.id} aria-labelledby={`recipe-${recipe.id}`}>
                        <div className="cooking-recipe-heading"><div><span>{recipe.technique} · {recipe.totalMinutes} 分钟</span><h4 id={`recipe-${recipe.id}`}>{recipe.name}</h4></div><a href={recipe.source.url} target="_blank" rel="noreferrer">{recipe.source.kind === "deepseek" ? "生成说明" : "查看来源"}</a></div>
                        <div className="step-list">{recipe.steps.map((step, index) => <div className="cooking-step" key={step.id}><div className="step-number">{index + 1}</div><div className="step-content"><div className="step-title-row"><h4>{step.title}</h4><span><Clock3 size={14} />{step.minutes} 分钟</span></div><p>{step.instruction}</p></div></div>)}</div>
                      </section>
                    ))}
                  </div>
                  <div className="single-completion-control"><button className="button primary" type="button" onClick={completeMeal}><CheckCircle2 size={19} />确认这顿饭完成</button></div>
                </>
              )}
              {status === "completed" && <div className="completion-card"><div className="completion-icon"><CheckCircle2 size={30} /></div><div><span>任务完成</span><h3>一顿饭完成，Harness 闭环已记录</h3><p>整个做饭过程只确认一次，右侧 Trace 保留检索、校验、审批和完成事件。</p></div><button className="button secondary" type="button" onClick={resetDemo}><RotateCcw size={17} />再演示一次</button></div>}
            </div>
          )}
        </section>

        <aside className="panel trace-panel">
          <div className="panel-heading trace-heading"><div><span className="step-label">运行实况</span><h2>Agent Trace</h2></div><span className="event-count">{traces.length} events</span></div>
          <div className="runtime-state-card"><div className="runtime-state-top"><span>当前状态</span><strong>{status.toUpperCase()}</strong></div><div className="state-flow">{stateOrder.map((item, index) => { const complete = index < currentStateIndex || status === "completed"; const active = index === currentStateIndex && status !== "completed"; return <div className={`state-node ${complete ? "complete" : ""} ${active ? "active" : ""}`} key={item.key}><span>{complete ? <Check size={12} /> : active ? <LoaderCircle className={isBusy ? "spin" : ""} size={12} /> : null}</span><small>{item.label}</small></div>; })}</div></div>
          <div className="trace-toolbar"><span><TerminalSquare size={15} />Timeline</span><span>实时</span></div>
          <div className="trace-list" ref={traceListRef}>
            {traces.length === 0 ? <div className="trace-empty"><Code2 size={22} /><p>Agent 启动后，检索、排序、Guardrail 和审批事件会显示在这里。</p></div> : traces.map((event, index) => { const Icon = traceIcons[event.kind]; return <article className={`trace-event trace-${event.status}`} key={event.id}><div className="trace-rail"><div className="trace-icon">{event.status === "running" ? <LoaderCircle className="spin" size={15} /> : <Icon size={15} />}</div>{index < traces.length - 1 && <i />}</div><div className="trace-body"><div className="trace-meta"><span>{event.kind}</span><time>{formatClock(event.createdAt)}</time></div><h3>{event.label}</h3><p>{event.detail}</p>{typeof event.durationMs === "number" && <small>{event.durationMs} ms</small>}</div></article>; })}
          </div>
          <div className="trace-footer"><Gauge size={16} /><div><strong>Context persisted</strong><span>刷新页面后可恢复最近状态</span></div></div>
        </aside>
      </div>

      <footer className="playful-footer"><div className="footer-sticker sticker sticker-pan" aria-hidden="true" /><p>HARNESS DEMO LITE · BUILT FOR THE REAL KITCHEN</p><h2>让 Agent 去找菜谱，<br />你只负责开饭。</h2><button className="footer-action" type="button" onClick={resetDemo}><RotateCcw size={20} />再跑一次完整流程</button></footer>
    </main>
  );
}
