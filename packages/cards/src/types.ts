/** 試算表的實裝狀態（見 docs/digital-spec.md 7.3）。 */
export const STATUSES = ["實裝", "測試", "未實裝"] as const;
export type Status = (typeof STATUSES)[number];

/** 卡片上的一個技能：【名稱】加上說明文字。道具與任務的效果沒有名稱。 */
export interface Skill {
  readonly name: string;
  readonly text: string;
}

export interface Adventurer {
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
  /** 雙面卡背面：對應正面的卡片編號。 */
  readonly backOf?: string;
}

export type Derivative = Omit<Adventurer, "backOf">;

export interface Item {
  readonly id: string;
  readonly name: string;
  readonly categories: readonly string[];
  readonly effect: string;
  readonly price: number | null;
  readonly flavor: string;
  readonly source: string;
  readonly status: string;
}

export type TaskCondition =
  | { readonly op: "atLeast"; readonly x: number }
  | { readonly op: "atMost"; readonly x: number }
  | { readonly op: "between"; readonly x: number; readonly y: number };

export interface Task {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly conditionText: string;
  readonly condition: TaskCondition | null;
  readonly tags: readonly string[];
  readonly specialRule: string;
  readonly gold: number | null;
  readonly reputation: number | null;
  readonly extraReward: string;
  readonly client: string;
  readonly flavor: string;
  readonly status: string;
}

export interface Honor {
  readonly id: string;
  readonly name: string;
  readonly route: string;
  readonly kind: string;
  readonly condition: string;
  readonly status: string;
}

export interface CardData {
  readonly adventurers: readonly Adventurer[];
  readonly derivatives: readonly Derivative[];
  readonly items: readonly Item[];
  readonly tasks: readonly Task[];
  readonly honors: readonly Honor[];
}

export type CardKind = keyof CardData;

export const KIND_LABEL: Record<CardKind, string> = {
  adventurers: "冒險者",
  derivatives: "衍生物",
  items: "道具",
  tasks: "任務",
  honors: "王國榮譽",
};

/** 卡片的唯一識別：有編號用編號；同編號（例如史詩任務正反面）或沒有編號時加上名稱。 */
export function cardKey(card: { readonly id: string; readonly name: string }): string {
  return card.id ? `${card.id}｜${card.name}` : `（無編號）｜${card.name}`;
}
