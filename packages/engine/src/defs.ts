/**
 * 規則引擎使用的卡片定義。
 * 欄位與 @ag/cards 的卡片資料相同（結構相容），引擎不直接依賴試算表管線。
 */
import type { Condition } from "./dice.js";

export interface AdventurerDef {
  readonly id: string;
  readonly name: string;
  readonly race: string;
  readonly profession: string;
  readonly traits: readonly string[];
  readonly baseDice: number | null;
  readonly salary: number | null;
  readonly status: string;
  readonly backOf?: string;
}

export interface TaskDef {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly condition: Condition | null;
  readonly tags: readonly string[];
  readonly gold: number | null;
  readonly reputation: number | null;
  readonly status: string;
}

export interface ItemDef {
  readonly id: string;
  readonly name: string;
  readonly categories: readonly string[];
  readonly price: number | null;
  readonly status: string;
}

export interface HonorDef {
  readonly id: string;
  readonly name: string;
  readonly route: string;
  readonly kind: string;
  readonly status: string;
}

/** 技能子句對照表的一列（data/skill-mapping.csv）。 */
export interface ClauseRow {
  readonly cardId: string;
  readonly cardName: string;
  readonly order: string;
  readonly skillName: string;
  readonly clause: string;
  readonly code: string;
  readonly x: string;
  readonly y: string;
  readonly z: string;
}

/** 卡片上的一個技能子句，對應一個技能模板。 */
export interface ClauseDef {
  readonly skill: string;
  readonly code: string;
  readonly x: string;
  readonly y: string;
  readonly z: string;
}

export interface CardSource {
  readonly adventurers: readonly AdventurerDef[];
  readonly tasks: readonly TaskDef[];
  readonly honors: readonly HonorDef[];
  readonly items?: readonly ItemDef[];
  readonly clauses?: readonly ClauseRow[];
}

/** 依實裝狀態整理出本局可用的卡池，並建立查詢表。 */
export class CardLibrary {
  readonly adventurers = new Map<string, AdventurerDef>();
  readonly tasks = new Map<string, TaskDef>();
  readonly honors = new Map<string, HonorDef>();
  /** 道具：以名稱查詢（卡片文字以名稱引用道具）。 */
  readonly items = new Map<string, ItemDef>();
  readonly adventurerPool: string[] = [];
  readonly taskPool: string[] = [];
  readonly epicPool: string[] = [];
  readonly honorPool: string[] = [];
  /** 卡片編號＋名稱 → 技能子句（依技能順序、子句順序排列）。 */
  private readonly clauseMap = new Map<string, ClauseDef[]>();

  constructor(source: CardSource, includeTest: boolean) {
    const rows = [...(source.clauses ?? [])].sort(
      (a, b) => Number(a.order) - Number(b.order) || Number(a.clause) - Number(b.clause),
    );
    for (const r of rows) {
      const key = `${r.cardId}｜${r.cardName}`;
      const list = this.clauseMap.get(key) ?? [];
      list.push({ skill: r.skillName, code: r.code, x: r.x, y: r.y, z: r.z });
      this.clauseMap.set(key, list);
    }
    const usable = (status: string) => status === "實裝" || (includeTest && status === "測試");
    for (const a of source.adventurers) {
      this.adventurers.set(a.id, a);
      if (!a.backOf && usable(a.status)) this.adventurerPool.push(a.id);
    }
    for (const t of source.tasks) {
      if (t.type.endsWith("(B)")) continue;
      const key = taskKey(t);
      this.tasks.set(key, t);
      if (!usable(t.status)) continue;
      (t.type === "史詩" ? this.epicPool : this.taskPool).push(key);
    }
    for (const i of source.items ?? []) if (usable(i.status)) this.items.set(i.name, i);
    for (const h of source.honors) {
      this.honors.set(h.id, h);
      if (usable(h.status) && h.kind === "排名型") this.honorPool.push(h.id);
    }
  }

  /** 卡片的技能子句；沒有對照資料時回傳空陣列。 */
  clauses(card: { readonly id: string; readonly name: string }): readonly ClauseDef[] {
    return this.clauseMap.get(`${card.id}｜${card.name}`) ?? [];
  }

  adventurer(id: string): AdventurerDef {
    const d = this.adventurers.get(id);
    if (!d) throw new Error(`找不到冒險者 ${id}`);
    return d;
  }

  task(key: string): TaskDef {
    const d = this.tasks.get(key);
    if (!d) throw new Error(`找不到任務 ${key}`);
    return d;
  }

  item(name: string): ItemDef {
    const d = this.items.get(name);
    if (!d) throw new Error(`找不到道具 ${name}`);
    return d;
  }

  honor(id: string): HonorDef {
    const d = this.honors.get(id);
    if (!d) throw new Error(`找不到王國榮譽 ${id}`);
    return d;
  }
}

/** 任務的識別：史詩任務的正反面共用編號，所以加上名稱。 */
export function taskKey(t: { readonly id: string; readonly name: string }): string {
  return `${t.id}｜${t.name}`;
}
