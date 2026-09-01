import type { InventoryCoverage, PlanInput, Recipe } from "./types";
import { ingredientMatchQuality, splitIngredients } from "./recipe-index";

const proteinPattern = /鸡|鸭|鹅|猪|牛|羊|鱼|虾|蟹|贝|肉|蛋|豆腐|豆干/;
const starchPattern = /米饭|饭|面|粉|馒头|饼|土豆|红薯|玉米/;
const animalProteinPattern = /鸡|鸭|鹅|猪|牛|羊|鱼|虾|蟹|贝|肉/;

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function unique(values: string[]) {
  return values.filter((value, index, all) => value && all.indexOf(value) === index);
}

function presentPantry(input: PlanInput, wanted: string[]) {
  const pantry = splitIngredients(input.pantry);
  return wanted.filter((term) => pantry.some((item) => ingredientMatchQuality(term, item) > 0));
}

export function analyzeInventoryCoverage(recipe: Recipe, input: PlanInput): InventoryCoverage {
  if (input.mode !== "ingredients") {
    return { used: [], unused: [], missing: [], pantryUsed: [], ratio: 1, zeroPurchase: false };
  }

  const inventory = splitIngredients(input.ingredients);
  const pantry = splitIngredients(input.pantry);
  const used = inventory.filter((item) => recipe.ingredients.some((ingredient) => ingredientMatchQuality(item, ingredient) > 0));
  const unused = inventory.filter((item) => !used.includes(item));
  const pantryUsed = pantry.filter((item) => recipe.ingredients.some((ingredient) => ingredientMatchQuality(item, ingredient) > 0));
  const missing = recipe.ingredients.filter((ingredient) =>
    !inventory.some((item) => ingredientMatchQuality(item, ingredient) > 0) &&
    !pantry.some((item) => ingredientMatchQuality(item, ingredient) > 0),
  );

  return {
    used,
    unused,
    missing: unique(missing),
    pantryUsed,
    ratio: inventory.length ? used.length / inventory.length : 1,
    zeroPurchase: input.zeroPurchase,
  };
}

function makeCoverage(inventory: string[], pantryUsed: string[], zeroPurchase: boolean): InventoryCoverage {
  return {
    used: inventory,
    unused: [],
    missing: [],
    pantryUsed,
    ratio: 1,
    zeroPurchase,
  };
}

function recipeSource(reference?: Recipe) {
  return {
    title: reference ? `库存适配 · 参考 ${reference.name}` : "库存适配 · 家庭烹饪技法模板",
    url: reference?.source?.url ?? "https://github.com/Anduin2017/HowToCook",
    license: "AI generated" as const,
    kind: "generated" as const,
  };
}

function description(scope: PlanInput["planScope"]) {
  return scope === "meal"
    ? "把现有食材拆成合理的一餐，允许分盘，但不要求购买新的非基础食材。"
    : "把现有食材组合成一道菜，只使用已声明库存与家中常备调料。";
}

export function composeInventoryRecipes(input: PlanInput, references: Recipe[] = [], limit = 2): Recipe[] {
  const inventory = splitIngredients(input.ingredients);
  if (input.mode !== "ingredients" || inventory.length === 0) return [];

  const protein = inventory.find((item) => proteinPattern.test(item));
  const starches = inventory.filter((item) => starchPattern.test(item));
  const vegetables = inventory.filter((item) => item !== protein && !starches.includes(item));
  const main = protein ?? vegetables[0] ?? starches[0] ?? inventory[0];
  const sides = vegetables.filter((item) => item !== main);
  const rice = starches.find((item) => /米饭|饭/.test(item));
  const pantryUsed = presentPantry(input, ["食用油", "盐", "水", "生抽"]);
  const oil = pantryUsed.find((item) => /油/.test(item));
  const salt = pantryUsed.find((item) => /盐/.test(item));
  const water = pantryUsed.find((item) => /水/.test(item));
  const soy = pantryUsed.find((item) => /生抽|酱油/.test(item));
  const seasoning = unique([oil, salt, soy].filter((item): item is string => Boolean(item)));
  const ingredients = unique([...inventory, ...pantryUsed]);
  const hasRawAnimal = inventory.some((item) => animalProteinPattern.test(item));
  const baseMinutes = hasRawAnimal ? 28 : inventory.length >= 3 ? 22 : 18;
  const cookMinutes = Math.max(3, hasRawAnimal ? 7 : 5);
  const vegText = vegetables.join("、") || "其余现有食材";
  const sideText = sides.join("、") || vegText;
  const sideLabel = sides.length > 1 ? "杂蔬" : sides[0] ?? (vegetables.length > 1 ? "杂蔬" : vegetables[0] ?? "");
  const seasonText = seasoning.length ? seasoning.join("、") : "已声明的常备调料";
  const riceInstruction = rice ? `将 ${rice} 打散或复热，保持松散。` : "整理主食或装盘空间。";
  const safetyText = hasRawAnimal ? `确认 ${main} 中心完全熟透、没有生肉色。` : "尝味并确认所有食材达到合适熟度。";
  const scopeName = input.planScope === "meal" ? "清冰箱一餐" : "零采购单菜";
  const coverage = makeCoverage(inventory, pantryUsed, input.zeroPurchase);

  const firstName = rice
    ? `${main}${sideLabel}盖饭`
    : `${main}${sideLabel}快炒`;
  const first: Recipe = {
    id: uid("inventory"),
    name: firstName,
    description: description(input.planScope),
    totalMinutes: baseMinutes,
    servings: input.servings,
    ingredients,
    tags: ["零采购", scopeName, "库存覆盖 100%"],
    rationale: `使用 ${inventory.join("、")}，新增采购 0 项；${pantryUsed.length ? `仅调用已声明常备调料 ${pantryUsed.join("、")}` : "不额外假设调料"}。`,
    technique: "炒",
    difficulty: "简单",
    activeMinutes: baseMinutes,
    advancePrepMinutes: 0,
    equipment: ["炒锅"],
    authenticity: "灵感方案",
    confidence: references[0] ? 0.88 : 0.78,
    inventoryCoverage: coverage,
    feasibility: {
      fitsTime: baseMinutes <= input.maxMinutes,
      severity: baseMinutes <= input.maxMinutes ? "ok" : "warning",
      message: baseMinutes <= input.maxMinutes ? "库存适配方案可在当前时间内完成。" : `可靠完成约需 ${baseMinutes} 分钟。`,
    },
    source: recipeSource(references[0]),
    steps: [
      { id: uid("step"), title: "核对库存", instruction: `只取 ${inventory.join("、")}；本方案不会调用库存外食材。`, minutes: 2 },
      { id: uid("step"), title: "集中备料", instruction: `将 ${main} 处理成易熟的小块；${vegText} 切成大小接近的块或片。`, minutes: 6 },
      { id: uid("step"), title: `先处理 ${main}`, instruction: `${oil ? `锅中放 ${oil}` : "使用不粘锅"}，中火处理 ${main} ${cookMinutes} 分钟。${safetyText}`, minutes: cookMinutes },
      { id: uid("step"), title: "加入现有配菜", instruction: `加入 ${vegText}${water ? `，需要时加少量 ${water}` : ""}，翻炒至断生。`, minutes: 6 },
      ...(rice ? [{ id: uid("step"), title: "组合主食", instruction: `${riceInstruction}将炒好的食材铺在 ${rice} 上。`, minutes: 4 }] : []),
      { id: uid("step"), title: "零采购收尾", instruction: `只用 ${seasonText} 调整味道，复核没有加入库存外食材后出锅。`, minutes: 3 },
    ],
  };

  const secondName = input.planScope === "meal" && rice
    ? `${main}${sideLabel}小炒 + ${rice}`
    : rice
      ? `${main}${sideLabel}炒饭`
      : `${main}${sideLabel}焖炒`;
  const secondTechnique = input.planScope === "meal" ? "煎炒" : rice ? "炒" : "焖";
  const second: Recipe = {
    ...first,
    id: uid("inventory"),
    name: secondName,
    totalMinutes: baseMinutes + 2,
    activeMinutes: baseMinutes + 2,
    technique: secondTechnique,
    source: recipeSource(references[1] ?? references[0]),
    rationale: input.planScope === "meal"
      ? `把 ${rice ?? "主食"} 与 ${main}、${vegText} 分开处理，整套餐食覆盖 ${inventory.length}/${inventory.length} 种库存，新增采购 0 项。`
      : `改用${secondTechnique}路线，仍覆盖 ${inventory.length}/${inventory.length} 种现有食材，新增采购 0 项。`,
    feasibility: {
      fitsTime: baseMinutes + 2 <= input.maxMinutes,
      severity: baseMinutes + 2 <= input.maxMinutes ? "ok" : "warning",
      message: baseMinutes + 2 <= input.maxMinutes ? "库存适配方案可在当前时间内完成。" : `可靠完成约需 ${baseMinutes + 2} 分钟。`,
    },
    steps: [
      { id: uid("step"), title: "锁定零采购清单", instruction: `本餐只使用 ${inventory.join("、")} 和已声明常备调料。`, minutes: 2 },
      { id: uid("step"), title: "准备食材", instruction: `将 ${main} 与 ${vegText} 分别处理，避免生熟食材交叉接触。`, minutes: 6 },
      ...(rice ? [{ id: uid("step"), title: `准备 ${rice}`, instruction: riceInstruction, minutes: 4 }] : []),
      { id: uid("step"), title: `煎炒 ${main}`, instruction: `${oil ? `使用 ${oil}` : "使用不粘锅"}将 ${main} 处理至合适熟度。${safetyText}`, minutes: cookMinutes },
      { id: uid("step"), title: "完成配菜", instruction: `用同一口锅处理 ${vegText}${water ? `，可加少量 ${water}` : ""}，保持口感。`, minutes: 6 },
      { id: uid("step"), title: "组成一餐", instruction: `${rice ? `将 ${rice} 与菜分区装盘` : "将全部食材装盘"}，只用 ${seasonText} 调味。`, minutes: 4 },
    ],
  };

  return [first, second].slice(0, limit);
}
