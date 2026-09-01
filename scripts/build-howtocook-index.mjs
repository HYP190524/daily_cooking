import { promises as fs } from "node:fs";
import path from "node:path";

const sourceRoot = process.argv[2];
const outputFile = process.argv[3];

if (!sourceRoot || !outputFile) {
  throw new Error("Usage: node scripts/build-howtocook-index.mjs <HowToCook root> <output json>");
}

const categories = {
  breakfast: "早餐",
  condiment: "调味与酱料",
  dessert: "甜品",
  drink: "饮品",
  meat_dish: "荤菜",
  "semi-finished": "半成品",
  soup: "汤羹",
  staple: "主食",
  template: "模板",
  vegetable_dish: "素菜",
};

const techniques = [
  ["凉拌", /凉拌|拌匀|冷拌/],
  ["蒸", /清蒸|蒸锅|蒸制|上锅蒸|蒸熟/],
  ["烤", /烤箱|烘烤|烤制/],
  ["炸", /油炸|炸至|复炸|炸制/],
  ["煨", /煨制|煨汤|小火煨/],
  ["炖", /炖煮|慢炖|小火炖|炖至/],
  ["煮", /煮沸|水煮|煮熟|下锅煮|汤/],
  ["焖", /焖制|焖煮|加盖焖|油焖/],
  ["卤", /卤水|卤制|卤煮/],
  ["煎", /煎至|香煎|煎制/],
  ["炒", /翻炒|爆炒|快炒|炒至/],
];

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(target)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(target);
  }
  return files;
}

function stripMarkdown(value) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sectionLines(lines, headingPattern) {
  const start = lines.findIndex((line) => /^#{2,4}\s+/.test(line) && headingPattern.test(line));
  if (start < 0) return [];
  const output = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,4}\s+/.test(lines[index])) break;
    output.push(lines[index]);
  }
  return output;
}

function listItems(lines, limit) {
  return lines
    .filter((line) => /^\s*(?:[-*+] |\d+[.)]\s+)/.test(line))
    .map((line) => stripMarkdown(line.replace(/^\s*(?:[-*+] |\d+[.)]\s+)/, "")))
    .filter((line) => line.length > 1 && !/^可选[：:]?$/.test(line))
    .slice(0, limit);
}

function parseRecipe(file, markdown) {
  const lines = markdown.split(/\r?\n/);
  const titleLine = lines.find((line) => /^#\s+/.test(line));
  const fallbackName = path.basename(file, ".md");
  const name = stripMarkdown(titleLine?.replace(/^#\s+/, "").replace(/的做法$/, "") ?? fallbackName);
  const difficultyMatch = markdown.match(/(?:预估)?烹饪难度[^★☆\n]*([★☆]+)/);
  const difficulty = difficultyMatch ? Math.max(1, [...difficultyMatch[1]].filter((mark) => mark === "★").length) : 2;
  const ingredientSection = sectionLines(lines, /(?:原料|食材|工具)/);
  const operationSection = sectionLines(lines, /(?:操作|步骤|做法)/);
  const ingredients = listItems(ingredientSection, 18);
  const steps = listItems(operationSection, 18);
  const relative = path.relative(path.join(sourceRoot, "dishes"), file).split(path.sep).join("/");
  const categoryKey = relative.split("/")[0];
  const haystack = `${name}\n${steps.join("\n")}`;
  const inferredTechniques = techniques.filter(([, pattern]) => pattern.test(haystack)).map(([label]) => label);

  return {
    name,
    aliases: [fallbackName].filter((alias) => alias !== name),
    category: categories[categoryKey] ?? categoryKey,
    difficulty,
    ingredients,
    steps,
    techniques: inferredTechniques.length ? inferredTechniques : ["其他"],
    sourcePath: `dishes/${relative}`,
    sourceUrl: `https://github.com/Anduin2017/HowToCook/blob/master/dishes/${encodeURI(relative)}`,
  };
}

const files = await walk(path.join(sourceRoot, "dishes"));
const recipes = [];
for (const file of files.sort((a, b) => a.localeCompare(b, "zh-CN"))) {
  const markdown = await fs.readFile(file, "utf8");
  const recipe = parseRecipe(file, markdown);
  if (recipe.name && recipe.ingredients.length && recipe.steps.length) recipes.push(recipe);
}

const techniqueCoverage = {};
for (const recipe of recipes) {
  for (const technique of recipe.techniques) techniqueCoverage[technique] = (techniqueCoverage[technique] ?? 0) + 1;
}

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(
  outputFile,
  `${JSON.stringify(
    {
      metadata: {
        name: "HowToCook local index",
        upstream: "https://github.com/Anduin2017/HowToCook",
        license: "Unlicense",
        generatedAt: new Date().toISOString(),
        recipeCount: recipes.length,
        techniqueCoverage,
      },
      recipes,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`Indexed ${recipes.length} recipes -> ${outputFile}`);
