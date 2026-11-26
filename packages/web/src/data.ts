/**
 * 測試模式使用的卡片資料：最新的工作版本（data/cards.json），
 * 包含「測試」狀態的卡片與技能子句。卡片文字逐字來自試算表。
 */
import built from "../../../data/cards.json";
import type { CardSource, ClauseRow } from "../../engine/src/index.js";

export interface Skill {
  readonly name: string;
  readonly text: string;
}

export interface RawAdventurer {
  readonly id: string;
  readonly name: string;
  readonly race: string;
  readonly profession: string;
  readonly traits: readonly string[];
  readonly skills: readonly Skill[];
  readonly baseDice: number | null;
  readonly salary: number | null;
  readonly flavor: string;
  readonly englishName: string;
  readonly story: string;
  readonly status: string;
  readonly backOf?: string;
}

export interface RawTask {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly conditionText: string;
  readonly tags: readonly string[];
  readonly specialRule: string;
  readonly gold: number | null;
  readonly reputation: number | null;
  readonly client: string;
  readonly flavor: string;
  readonly status: string;
}

export interface RawItem {
  readonly id: string;
  readonly name: string;
  readonly categories: readonly string[];
  readonly effect: string;
  readonly price: number | null;
  readonly flavor: string;
  readonly status: string;
}

export interface RawHonor {
  readonly id: string;
  readonly name: string;
  readonly route: string;
  readonly condition: string;
}

const data = built as unknown as {
  builtAt: string;
  cards: {
    adventurers: RawAdventurer[];
    derivatives: RawAdventurer[];
    items: RawItem[];
    tasks: RawTask[];
    honors: RawHonor[];
  };
  clauses: ClauseRow[];
};

export const builtAt = data.builtAt;

export const source: CardSource = {
  ...(data.cards as unknown as CardSource),
  clauses: data.clauses.map((c) => ({ ...c, cardId: c.cardId === "（無編號）" ? "" : c.cardId })),
};

/** 依卡片編號查詢冒險者或衍生物的原始資料（顯示用）。 */
export const adventurerText = new Map<string, RawAdventurer>(
  [...data.cards.adventurers, ...data.cards.derivatives].map((a) => [a.id, a]),
);
export const taskText = new Map<string, RawTask>(data.cards.tasks.map((t) => [`${t.id}｜${t.name}`, t]));
export const itemText = new Map<string, RawItem>(data.cards.items.map((i) => [i.name, i]));
export const honorText = new Map<string, RawHonor>(data.cards.honors.map((h) => [h.id, h]));

/** 去掉雙面卡背面在原始資料中的「(B)」註記（只用於顯示；規則引擎比較時也會忽略）。 */
export const stripBackMark = (s: string) => s.replace(/\(B\)$/, "");
const cleanFace = (a: RawAdventurer): RawAdventurer => ({ ...a, race: stripBackMark(a.race), profession: stripBackMark(a.profession) });

/** 冒險者圖鑑用：正面的冒險者（背面另外查詢）與衍生物，略過未實裝的卡片。 */
export const codexAdventurers: readonly RawAdventurer[] = data.cards.adventurers.filter((a) => !a.backOf && !a.id.endsWith("B") && a.status !== "未實裝");
export const codexDerivatives: readonly RawAdventurer[] = data.cards.derivatives.filter((a) => a.status !== "未實裝");
/** 雙面卡的背面：正面編號 → 背面。 */
export const backFaces = new Map<string, RawAdventurer>(
  data.cards.adventurers.filter((a) => a.id.endsWith("B")).map((a) => [a.backOf ?? a.id.slice(0, -1), cleanFace(a)]),
);
