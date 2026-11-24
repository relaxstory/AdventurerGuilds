import { parseCsv } from "./csv.js";
import type { Adventurer, CardData, Derivative, Honor, Item, Skill, Task, TaskCondition } from "./types.js";

const norm = (s: string) => s.replace(/\s+/g, "");

/** 找出標題列：第一個含有「卡片ID」或「卡片編號」的列。 */
function headerIndex(rows: string[][]): number {
  const i = rows.findIndex((r) => r.some((c) => ["卡片ID", "卡片編號"].includes(norm(c))));
  if (i < 0) throw new Error("找不到標題列（需要「卡片ID」或「卡片編號」欄）");
  return i;
}

interface Table {
  readonly rows: string[][];
  get(row: string[], column: string): string;
}

/**
 * 依欄名讀取。同名欄位取第一個。fallback 為欄名空白時的位置（例如冒險者分頁的基礎骰數、薪資）。
 */
function table(csv: string, fallback: Record<string, number> = {}): Table {
  const all = parseCsv(csv);
  const h = headerIndex(all);
  const header = all[h]!.map(norm);
  const index = (column: string): number => {
    const i = header.indexOf(norm(column));
    if (i >= 0) return i;
    const f = fallback[column];
    if (f !== undefined) return f;
    throw new Error(`找不到欄位「${column}」`);
  };
  const cache = new Map<string, number>();
  return {
    rows: all.slice(h + 1).filter((r) => r.some((c) => c.trim() !== "")),
    get(row, column) {
      if (!cache.has(column)) cache.set(column, index(column));
      return (row[cache.get(column)!] ?? "").trim();
    },
  };
}

export function parseInt0(value: string): number | null {
  const v = value.trim();
  if (v === "" || v.toUpperCase() === "N/A") return null;
  return /^[-+]?\d+$/.test(v) ? Number(v) : NaN;
}

export function parseTags(value: string): string[] {
  return value.match(/[\[［][^\]］]+[\]］]/g)?.map((t) => `[${t.slice(1, -1)}]`) ?? [];
}

/** 技能欄：每個技能以【名稱】開頭，技能之間以空行分隔。 */
export function parseSkills(value: string): Skill[] {
  const text = value.replace(/\r\n/g, "\n").trim();
  if (text === "" || text.toUpperCase() === "N/A") return [];
  return text
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const m = chunk.match(/^【([^】]+)】\s*\n?([\s\S]*)$/);
      return m ? { name: `【${m[1]}】`, text: m[2]!.trim() } : { name: "", text: chunk };
    });
}

/** 任務目標：≥X、≤X、X～Y。 */
export function parseCondition(value: string): TaskCondition | null {
  const v = value.replace(/\s+/g, "");
  let m = v.match(/^(?:≥|>=)(\d+)$/);
  if (m) return { op: "atLeast", x: Number(m[1]) };
  m = v.match(/^(?:≤|<=)(\d+)$/);
  if (m) return { op: "atMost", x: Number(m[1]) };
  m = v.match(/^(\d+)[～~〜](\d+)$/);
  if (m) return { op: "between", x: Number(m[1]), y: Number(m[2]) };
  return null;
}

export function parseAdventurers(csv: string): Adventurer[] {
  const t = table(csv, { 基礎骰數: 6, 薪資: 7 });
  return t.rows
    .filter((r) => t.get(r, "冒險者名稱") !== "")
    .map((r) => {
      const id = t.get(r, "卡片ID");
      const card: Adventurer = {
        id,
        name: t.get(r, "冒險者名稱"),
        race: t.get(r, "種族"),
        profession: t.get(r, "職業"),
        traits: parseTags(t.get(r, "特質")),
        skills: parseSkills(t.get(r, "技能")),
        baseDice: parseInt0(t.get(r, "基礎骰數")),
        salary: parseInt0(t.get(r, "薪資")),
        flavor: t.get(r, "風味文字"),
        englishName: t.get(r, "英文名稱"),
        story: t.get(r, "故事背景"),
        status: t.get(r, "實裝狀態"),
      };
      return /B$/.test(id) ? { ...card, backOf: id.slice(0, -1) } : card;
    });
}

export function parseDerivatives(csv: string): Derivative[] {
  const t = table(csv);
  return t.rows
    .filter((r) => t.get(r, "冒險者名稱") !== "")
    .map((r) => ({
      id: t.get(r, "卡片編號"),
      name: t.get(r, "冒險者名稱"),
      race: t.get(r, "種族"),
      profession: t.get(r, "職業"),
      traits: parseTags(t.get(r, "特質")),
      skills: parseSkills(t.get(r, "特徵")),
      baseDice: parseInt0(t.get(r, "基礎骰數")),
      salary: parseInt0(t.get(r, "薪資")),
      flavor: t.get(r, "風味文字"),
      englishName: t.get(r, "英文名稱"),
      story: t.get(r, "故事背景"),
      status: t.get(r, "實裝狀態"),
    }));
}

export function parseItems(csv: string): Item[] {
  const t = table(csv);
  return t.rows
    .filter((r) => t.get(r, "道具名稱") !== "")
    .map((r) => ({
      id: t.get(r, "卡片編號"),
      name: t.get(r, "道具名稱"),
      categories: parseTags(t.get(r, "分類")),
      effect: t.get(r, "功能"),
      price: parseInt0(t.get(r, "售價")),
      flavor: t.get(r, "風味文字"),
      source: t.get(r, "來源"),
      status: t.get(r, "實裝狀態"),
    }));
}

export function parseTasks(csv: string): Task[] {
  const t = table(csv);
  return t.rows
    .filter((r) => t.get(r, "任務名稱") !== "")
    .map((r) => {
      const conditionText = t.get(r, "任務目標");
      return {
        id: t.get(r, "卡片編號"),
        name: t.get(r, "任務名稱"),
        description: t.get(r, "任務敘述"),
        type: t.get(r, "任務時效"),
        conditionText,
        condition: parseCondition(conditionText),
        tags: parseTags(t.get(r, "標籤")),
        specialRule: t.get(r, "特殊規則"),
        gold: parseInt0(t.get(r, "獎勵(金)")),
        reputation: parseInt0(t.get(r, "獎勵(聲望)")),
        extraReward: t.get(r, "額外獎勵"),
        client: t.get(r, "委託人"),
        flavor: t.get(r, "風味文字(一行14個全形)一二三四五六七八九十一二三四五六七八九十一二三四"),
        status: t.get(r, "實裝狀態"),
      };
    });
}

export function parseHonors(csv: string): Honor[] {
  const t = table(csv);
  return t.rows
    .filter((r) => t.get(r, "名稱") !== "")
    .map((r) => ({
      id: t.get(r, "卡片編號"),
      name: t.get(r, "名稱"),
      route: t.get(r, "路線"),
      kind: t.get(r, "類型"),
      condition: t.get(r, "條件"),
      status: t.get(r, "實裝狀態"),
    }));
}

export function parseAll(raw: Record<keyof CardData, string>): CardData {
  return {
    adventurers: parseAdventurers(raw.adventurers),
    derivatives: parseDerivatives(raw.derivatives),
    items: parseItems(raw.items),
    tasks: parseTasks(raw.tasks),
    honors: parseHonors(raw.honors),
  };
}
