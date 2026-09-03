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

function matchesAny(target: string, candidates: string[]) {
  return candidates.some((candidate) => ingredientMatches(target, candidate));
}

export function isDefaultPantryIngredient(value: string) {
  return matchesAny(value, DEFAULT_PANTRY);
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
