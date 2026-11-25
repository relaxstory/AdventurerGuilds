import type { RngState } from "./rng.js";

export type HonorMode = "selection" | "assignment" | "competition";
export type HonorDraw = "balanced" | "random";

export interface PlayerConfig {
  readonly id: string;
  readonly name: string;
}

export interface GameConfig {
  readonly seed: number;
  readonly players: readonly PlayerConfig[];
  /** 王國評選（selection）／王國指派（assignment）／王國競爭（competition）。 */
  readonly honorMode: HonorMode;
  /** 依路線平均（balanced）／完全隨機（random）。 */
  readonly honorDraw: HonorDraw;
  readonly includeEpic: boolean;
  /** 測試模式：卡池加入實裝狀態為「測試」的卡片。 */
  readonly includeTest: boolean;
  readonly rounds?: number;
  /** 輪末補助的金幣下限，預設 RULES.roundEndGoldFloor；0 表示關閉。 */
  readonly goldFloor?: number;
  /** 二階公會升級方案（試驗中），預設 RULES.upgradeVariant。 */
  readonly upgradeVariant?: UpgradeVariant;
  /** 任務供應方式（試驗中）：預設 RULES.taskSupply。board＝只從公告欄拿；deckTop＝也可以拿牌庫頂；refill＝每個玩家回合開始時補滿公告欄。 */
  readonly taskSupply?: "board" | "deckTop" | "refill";
}

export interface AdventurerCard {
  readonly uid: string;
  readonly defId: string;
  /** 目前朝上的一面：正面或背面（雙面卡）。 */
  face: "front" | "back";
  tapped: boolean;
  tokens: Record<string, number>;
  /** 本輪已經用過「每輪第一次派遣不橫置」的輪次。 */
  freeDispatchRound?: number;
  /** 菲特【如果當時……】：被暫時翻面的卡片，記錄菲特的 uid；能力結束前不能再翻面。 */
  flipLock?: string;
  /** 菲特：放在哪張卡的下方（輪末移回原位）。 */
  under?: string;
  /** 衍生物（不佔容量，被銷毀時回到衍生物牌組）。 */
  derivative?: boolean;
  /** 瑪絲珂的工作室：可以創造的衍生物名稱。 */
  workshop?: string[];
  /** 新兵小隊：這張卡是隊長時，底下的成員（由上到下，不含隊長）。 */
  squad?: string[];
  /** 本輪的基礎骰數修正（藥劑、紅斑菌菇）。 */
  roundBaseDelta?: { round: number; delta: number };
  /** 本輪輪末無法重置（紅斑菌菇）。 */
  noResetRound?: number;
  /** 本輪被派遣的次數：輪次識別與次數。 */
  dispatches?: { turn: string; count: number };
}

export interface ItemCard {
  readonly uid: string;
  /** 道具名稱。 */
  readonly name: string;
  tokens: Record<string, number>;
}

/** 進行中的派遣（docs/spec.md 7.1）。組隊 → 擲骰 → 調整 → 結算。 */
export interface Mission {
  readonly task: string;
  /** 被派遣的冒險者（支付薪資）。 */
  readonly dispatched: string[];
  /** 以其他方式加入、不視為派遣的冒險者（例如瑞斯教授的空間傳送）。 */
  readonly joined: string[];
  readonly salary: number;
  stage: "assemble" | "adjust";
  dice: number[];
  /** 骰池建構時的骰數。 */
  pool: number;
  /** 因能力移除的骰子數，依冒險者 uid 記錄（莎莉【應該也不算太差？】）。 */
  removedBy: Record<string, number>;
  /** 擲骰前的預言（怪盜雞德）：uid → 奇數或偶數。 */
  predictions: Record<string, "odd" | "even">;
  /** 自選的基礎骰數（古斯）：uid → 骰數。 */
  baseDice: Record<string, number>;
  /** 擲骰後能力的使用紀錄：`${uid}:${模板代碼}` → 已使用次數。 */
  used: Record<string, number>;
  /** 每張卡已經轉動過的骰子（以骰子編號記錄，每顆各 1 次）。 */
  turned: Record<string, number[]>;
  /** 結果值的調整（喀嘣小嗶）。 */
  resultDelta: number;
  /** 結果值倍數（希氏炸藥：兩倍）。 */
  resultTimes: number;
  /** 視為成功（兜的和弦）。 */
  autoSuccess: boolean;
  /** 馬文【加注】：加注時任務是否已經成功、重擲了幾顆。 */
  gamble: { uid: string; count: number; successBefore: boolean } | null;
}

export interface TaskCard {
  readonly uid: string;
  readonly defKey: string;
  attempts: number;
  /** 永久任務的完成指示物。 */
  completions: number;
}

export interface FormalTask {
  readonly uid: string;
  /** 剩餘時限；null 表示 [∞]。 */
  timer: number | null;
}

/** 二階公會的加成：冒險者格、任務暫存格或道具格 +1。 */
export type UpgradeBonus = "adventurer" | "staging" | "item" | "task";

/**
 * 二階公會升級方案（試驗中，docs/versions.md alpha1.2）：
 * choice＝三選一各 +1；adventurer2＝冒險者格改為 +2；specialize＝固定暫存格 +1 再選專精；paid＝三選一，使用額外格子要付 2 金。
 */
export type UpgradeVariant = "choice" | "adventurer2" | "specialize" | "paid";

/** 升級後的效果，在升級時依方案計算後存下來。 */
export interface UpgradePerks {
  readonly adventurer: number;
  readonly staging: number;
  readonly item: number;
  /** 每回合第一次招募不消耗公會行動。 */
  readonly freeRecruit?: boolean;
  /** 任務移入正式任務區時，時限 +N。 */
  readonly timer?: number;
  /** 任務失敗時，額外獲得 N 個嘗試指示物。 */
  readonly extraAttempt?: number;
  /** 出售道具時，額外獲得 N 金。 */
  readonly sellBonus?: number;
  /** 使用額外格子時要付金幣（冒險者格只在第一次使用時付）。 */
  readonly paidExtra?: number;
}

export interface PlayerState {
  readonly id: string;
  readonly name: string;
  gold: number;
  reputation: number;
  distrust: number;
  /** 已升級為二階公會。 */
  upgraded: boolean;
  /** 升級時選擇的加成；尚未升級為 null。 */
  upgradeBonus: UpgradeBonus | null;
  upgradePerks: UpgradePerks | null;
  /** 本回合已經用過「第一次招募不消耗公會行動」。 */
  freeRecruitUsed: boolean;
  /** 已經為額外的冒險者格付過費用。 */
  paidAdventurerSlot: boolean;
  actionsLeft: number;
  /** 本回合已經執行的派遣次數。 */
  missionsThisTurn: number;
  adventurers: string[];
  staging: string[];
  formal: FormalTask[];
  completed: string[];
  items: string[];
  /** 王國指派模式：分到的王國榮譽卡。 */
  assignedHonors: string[];
}

export type Phase = "guild" | "adventure" | "cleanup" | "gameOver";

/**
 * 等待某位玩家做決定（docs/spec.md 13A.5）。決定之前，其他操作都會被擋下。
 * player 是要做決定的玩家，不一定是目前回合的玩家。
 */
export type Pending =
  /** 布魯斯【布魯斯！】：橫置自己公會中的一名直立冒險者，或支付 amount 金幣給 from。 */
  | { readonly kind: "tapOrPay"; readonly player: string; readonly from: string; readonly amount: number; readonly source: string }
  /** 里諾【你好，我可以逮捕你嗎？】：橫置自己公會中的一名直立冒險者，或將 source 翻面。 */
  | { readonly kind: "tapOrFlip"; readonly player: string; readonly from: string; readonly source: string }
  /** 狂人里諾【我給過你機會了】：從 targets 中選一名冒險者橫置。 */
  | { readonly kind: "tapTarget"; readonly player: string; readonly source: string; readonly targets: readonly string[] }
  /** 道具區超過上限：從 items 中選一個捨棄。 */
  | { readonly kind: "discardItem"; readonly player: string; readonly items: readonly string[] }
  /** 選擇要獲得的道具；optional 為 true 時可以不拿。 */
  | { readonly kind: "chooseItem"; readonly player: string; readonly options: readonly string[]; readonly optional: boolean; readonly source: string }
  /** 選擇一名其他玩家，把道具放在他面前（梅里妲的注視）。 */
  | { readonly kind: "givePlayer"; readonly player: string; readonly item: string; readonly source: string }
  /** 瑪絲珂【工作室】：從 options 中選 count 張不同名稱的衍生物。 */
  | { readonly kind: "chooseWorkshop"; readonly player: string; readonly source: string; readonly options: readonly string[]; readonly count: number }
  /** 重置至多 count 名冒險者（汐的和弦、小丑小嗶）；可以少選或不選。 */
  | { readonly kind: "resetAdventurers"; readonly player: string; readonly source: string; readonly count: number; readonly candidates: readonly string[] }
  /** 蕾的和弦：選擇一個任務時限 +amount；可以不選。 */
  | { readonly kind: "extendTask"; readonly player: string; readonly source: string; readonly amount: number; readonly candidates: readonly string[] }
  /** 梅里妲的注視：銷毀自己公會中的一名冒險者。 */
  | { readonly kind: "destroyOwn"; readonly player: string; readonly source: string; readonly candidates: readonly string[] }
  /** 是否使用「你可以改為銷毀……」的替代效果。 */
  | {
      readonly kind: "confirmReplace";
      readonly player: string;
      readonly what: "adventurer" | "item";
      /** 原本要被銷毀的冒險者或道具。 */
      readonly target: string;
      /** 改為銷毀的冒險者（瓦雷諾）或道具（戈拉古斯的手稿）。 */
      readonly replacement: string;
    };

export interface LogEntry {
  readonly round: number;
  readonly player: string | null;
  readonly text: string;
  readonly dice?: readonly number[];
}

export interface HonorResult {
  readonly honorId: string;
  readonly values: Record<string, number>;
  readonly winners: readonly string[];
  /** 王國指派模式：持有者。 */
  readonly holder?: string;
}

export interface GameResult {
  readonly honors: readonly HonorResult[];
  readonly totals: Record<string, number>;
  readonly winners: readonly string[];
}

export interface GameState {
  readonly config: GameConfig;
  rng: RngState;
  round: number;
  startPlayer: number;
  /** 本輪已經進行到第幾位玩家（0 起算，依起始玩家輪替）。 */
  turnInRound: number;
  phase: Phase;
  players: PlayerState[];
  adventurerCards: Record<string, AdventurerCard>;
  taskCards: Record<string, TaskCard>;
  adventurerDeck: string[];
  tavern: string[];
  adventurerDiscard: string[];
  taskDeck: string[];
  board: (string | null)[];
  taskDiscard: string[];
  /** 本局使用的王國榮譽卡。 */
  honors: string[];
  /** 等待某位玩家做決定。 */
  pending: Pending | null;
  /** 排隊中的決定：目前的決定完成後依序處理。 */
  pendingQueue: Pending[];
  itemCards: Record<string, ItemCard>;
  /** 道具編號的流水號。 */
  itemSeq: number;
  /** 衍生物編號的流水號。 */
  derivativeSeq: number;
  /** 被銷毀（移出遊戲）的冒險者。 */
  destroyed: string[];
  /** 已經出現過的【獨特】道具（整場遊戲只有一份，銷毀後也不會再出現）。 */
  uniquesCreated: string[];
  /** 回合開始的時機：回合開始後、做任何其他操作之前（凱菲【我先睡一下……】）。 */
  turnStartOpen: boolean;
  /** 冒險階段：進行中的派遣。 */
  mission: Mission | null;
  /** 公會整理階段：還沒處理的逾期任務（遇到需要玩家選擇懲罰的任務時停下）。 */
  pendingExpiry: string[];
  /** 史詩任務：已經嘗試過的任務（只能嘗試一次）。 */
  epicTried: string[];
  log: LogEntry[];
  result: GameResult | null;
}

export function currentPlayerIndex(state: GameState): number {
  return (state.startPlayer + state.turnInRound) % state.players.length;
}

export function currentPlayer(state: GameState): PlayerState {
  return state.players[currentPlayerIndex(state)]!;
}
