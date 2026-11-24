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

export interface PlayerState {
  readonly id: string;
  readonly name: string;
  gold: number;
  reputation: number;
  distrust: number;
  upgraded: boolean;
  actionsLeft: number;
  /** 本回合已經執行的派遣次數。 */
  missionsThisTurn: number;
  adventurers: string[];
  staging: string[];
  formal: FormalTask[];
  completed: string[];
  /** 王國指派模式：分到的王國榮譽卡。 */
  assignedHonors: string[];
}

export type Phase = "guild" | "adventure" | "cleanup" | "gameOver";

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
