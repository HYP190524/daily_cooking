import { ingredientMatches, normalizeIngredient } from "./ingredient-normalizer";

export const DEFAULT_PANTRY_LABEL = "中式家常基础调料";

export const DEFAULT_PANTRY = [
  "水",
  "食用油",
  "盐",
  "白糖",
  "生抽",
  "老抽",
  "醋",
  "料酒",
  "淀粉",
  "葱",
  "姜",
  "蒜",
];

const specialtySeasonings = [
  "蚝油",
  "鸡精",
  "味精",
  "胡椒粉",
  "白胡椒粉",
  "黑胡椒",
  "八角",
  "香叶",
  "桂皮",
  "花椒",
  "青花椒",
  "五香粉",
  "十三香",
  "孜然粉",
  "辣椒粉",
  "辣椒油",
  "香油",
  "芝麻油",
  "麻油",
  "豆瓣酱",
  "郫县豆瓣酱",
  "黄豆酱",
  "甜面酱",
  "芝麻酱",
  "番茄酱",
  "蒸鱼豉油",
  "豆豉",
  "蜂蜜",
  "冰糖",
  "干辣椒",
  "小米辣",
  "小米椒",
  "白芝麻",
  "芝麻",
  "啤酒",
];

const normalizedSpecialtySeasonings = new Set(specialtySeasonings.map(normalizeIngredient));

function aromaticFamily(value: string) {
  const normalized = normalizeIngredient(value);
  // Aromatics are kitchen basics, not inventory-closing main ingredients.
  // Keep this lexical on purpose so “蒜2瓣”“姜片”“葱段” do not depend on
  // quantity parsing. Vegetable forms such as 蒜苗/蒜苔 remain inventory.
  if (/^(?:小葱|大葱|香葱|葱)/.test(normalized) && !/^葱头/.test(normalized)) return "葱";
  if (/^姜/.test(normalized)) return "姜";
  if (/^蒜/.test(normalized) && !/^蒜(?:苗|苔|薹)/.test(normalized)) return "蒜";
  return "";
}

function matchesAny(target: string, candidates: string[]) {
  const normalizedTarget = normalizeIngredient(target);
  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeIngredient(candidate);
    return ingredientMatches(target, candidate)
      || (aromaticFamily(normalizedTarget) !== ""
        && aromaticFamily(normalizedTarget) === aromaticFamily(normalizedCandidate));
  });
}

export function isDefaultPantryIngredient(value: string) {
  return aromaticFamily(value) !== "" || matchesAny(value, DEFAULT_PANTRY);
}

export function isSpecialtySeasoning(value: string) {
  return normalizedSpecialtySeasonings.has(normalizeIngredient(value));
}

export function isUnavailableSeasoning(value: string, unavailable: string[]) {
  return matchesAny(value, unavailable);
}

export function seasoningKind(value: string, unavailable: string[]) {
  if (isUnavailableSeasoning(value, unavailable)) return "blocked" as const;
  if (isDefaultPantryIngredient(value)) return "default" as const;
  if (isSpecialtySeasoning(value)) return "specialty" as const;
  return null;
}
