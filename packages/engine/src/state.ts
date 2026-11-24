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
