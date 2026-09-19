const aliasGroups: Record<string, string[]> = {
  鸡腿: ["琵琶腿", "鸡小腿", "手枪腿", "大鸡腿", "鸡腿肉"],
  鸡翅: ["鸡中翅", "鸡翅中", "鸡翅根", "新鲜鸡翅"],
  鸡胸肉: ["鸡胸", "鸡脯肉"],
  鸡肉: ["仔鸡", "整鸡"],
  牛肉: ["牛腩", "牛里脊", "牛腱", "牛肉片", "牛肉块", "牛肉末", "牛肉丝", "肥牛"],
  香菜: ["芫荽", "香菜段", "香菜叶", "芫荽段"],
  排骨: ["猪小排", "小排", "肋排", "精排", "猪肉排骨"],
  西红柿: ["番茄"],
  土豆: ["马铃薯"],
  黄瓜: ["青瓜"],
  花菜: ["菜花"],
  青菜: ["上海青", "小白菜", "油菜", "油麦菜"],
  白萝卜: ["萝卜"],
  红薯: ["地瓜"],
  盐: ["食盐", "食用盐", "海盐"],
  醋: ["白醋", "陈醋", "香醋", "米醋"],
  葱: ["小葱", "大葱", "香葱", "葱花", "葱段", "小葱花"],
  姜: ["生姜", "姜片", "姜末"],
  蒜: ["大蒜", "蒜头", "蒜瓣", "蒜末", "蒜蓉"],
  料酒: ["黄酒", "黄酒或料酒"],
  生抽: ["酱油", "生抽酱油"],
  食用油: ["植物油", "菜籽油", "花生油", "玉米油"],
  白糖: ["糖", "砂糖", "白砂糖"],
  水: ["清水", "热水", "温水", "高汤"],
};

const genericParents: Record<string, string[]> = {
  鸡肉: ["鸡腿", "鸡胸肉"],
  猪肉: ["排骨", "五花肉", "里脊肉", "肉末"],
  萝卜: ["白萝卜", "胡萝卜"],
  土豆: ["土豆块", "土豆片", "土豆条", "马铃薯块"],
};

const equipmentPattern = /(?:锅|砧板|菜刀|削皮刀|手套|夹子|蒸笼|烤盘|盘子|保鲜袋|温度计|大碗|小碗|工具|设备|厨具)/;
const headingPattern = /^(?:原料|食材|材料|工具|调味料|调料)$/;
const optionalPattern = /可选|可以不用|没有可不放|备选|按需|任选|不吃可不放/;
const quantityPattern = /\d+(?:\.\d+)?\s*(?:kg|g|ml|克|千克|公斤|毫升|升|个|只|根|片|块|颗|勺|茶匙|汤匙|人份).*$/i;

function basicNormalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[!！]/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(quantityPattern, "")
    .replace(/^(?:原料|食材|材料|调味料|调料)[：:]?/, "")
    .replace(/(?:适量|少许|若干|一小撮|一丢丢)$/g, "")
    .replace(/[\s，,、。；;：:\-_/]/g, "")
    .trim();
}

const aliasEntries = Object.entries(aliasGroups)
  .flatMap(([canonical, aliases]) => [canonical, ...aliases].map((alias) => [basicNormalize(alias), canonical] as const))
  .sort((left, right) => right[0].length - left[0].length);

export function normalizeIngredient(value: string) {
  const normalized = basicNormalize(value);
  if (!normalized) return "";
  const exact = aliasEntries.find(([alias]) => normalized === alias);
  if (exact) return exact[1];
  return normalized;
}

export function splitIngredientInput(value: string) {
  const tokens = value
    .split(/[，,、;；\n\s]+/)
    .map(normalizeIngredient)
    .filter(Boolean);
  return [...new Set(tokens)];
}

export function ingredientMatches(leftValue: string, rightValue: string) {
  const left = normalizeIngredient(leftValue);
  const right = normalizeIngredient(rightValue);
  if (!left || !right) return false;
  if (left === right) return true;
  if (genericParents[left]?.includes(right) || genericParents[right]?.includes(left)) return true;
  return right.includes(left) && left.length >= 2;
}

export interface IngredientRequirement {
  raw: string;
  name: string;
  optional: boolean;
}

export function extractRecipeRequirements(lines: string[]) {
  const requirements: IngredientRequirement[] = [];
  for (const line of lines) {
    const optional = optionalPattern.test(line);
    // HowToCook entries often put recommendations in parentheses, and those
    // recommendations can contain commas. Remove the parenthetical prose
    // before splitting so "新鲜鸡翅（推荐选择鸡翅中，肉质更嫩）" remains one
    // retrievable ingredient instead of becoming two malformed requirements.
    const cleanedLine = line.replace(/[（(][^）)]*[）)]/g, "");
    const fragments = cleanedLine.split(/[，,、；;]+/);
    for (const fragment of fragments) {
      const raw = fragment.trim();
      const name = normalizeIngredient(raw);
      if (!name || headingPattern.test(name) || equipmentPattern.test(raw)) continue;
      if (name.length > 18 && /例如|可以是|建议|选择|等/.test(raw)) continue;
      if (requirements.some((item) => ingredientMatches(item.name, name))) continue;
      requirements.push({ raw, name, optional });
    }
  }
  return requirements;
}

export function findMatchingIngredient(target: string, available: string[]) {
  return available.find((item) => ingredientMatches(target, item));
}

export function normalizeDishQuery(value: string) {
  return value
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/(?:怎么做|如何做|的做法|做法|菜谱|食谱)/g, "")
    .replace(/[\s，,、。！？!?;；:：\-_/]/g, "")
    .trim();
}
