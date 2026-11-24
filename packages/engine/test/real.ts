/** 用存放庫中的真實卡片資料（最新發布版本＋子句對照表）建立測試用的遊戲。 */
import { readFileSync } from "node:fs";
import { parseCsv } from "../../cards/src/csv.js";
import { applyAction, type Action } from "../src/actions.js";
import { CardLibrary, type CardSource, type ClauseRow } from "../src/defs.js";
import { createGame } from "../src/setup.js";
import { currentPlayer, type GameState, type Mission } from "../src/state.js";
import { config } from "./fixture.js";

const root = new URL("../../../data/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("versions/index.json", root), "utf-8"));
const cards = JSON.parse(readFileSync(new URL(`versions/v${index.latest}.json`, root), "utf-8")).cards;
const [, ...rows] = parseCsv(readFileSync(new URL("skill-mapping.csv", root), "utf-8"));
const clauses: ClauseRow[] = rows
  .filter((r) => r.length > 5)
  .map(([cardId = "", cardName = "", order = "", skillName = "", clause = "", code = "", x = "", y = "", z = ""]) => ({
    cardId: cardId === "（無編號）" ? "" : cardId, cardName, order, skillName, clause, code, x, y, z,
  }));

export const realSource: CardSource = { ...cards, clauses };

export function realGame(): { state: GameState; lib: CardLibrary } {
  const cfg = config({ includeTest: true });
  return { state: createGame(cfg, realSource), lib: new CardLibrary(realSource, true) };
}

let next = 1000;
/** 讓目前玩家擁有指定的冒險者（卡片編號），回傳 uid。 */
export function hire(state: GameState, ...defIds: string[]): string[] {
  return defIds.map((defId) => {
    const back = defId.endsWith("B");
    const uid = `x${next++}`;
    state.adventurerCards[uid] = { uid, defId: back ? defId.slice(0, -1) : defId, face: back ? "back" : "front", tapped: false, tokens: {} };
    currentPlayer(state).adventurers.push(uid);
    return uid;
  });
}

/** 讓指定的玩家（依座位，0 起算）擁有冒險者，回傳 uid。 */
export function hireFor(state: GameState, seat: number, ...defIds: string[]): string[] {
  return defIds.map((defId) => {
    const back = defId.endsWith("B");
    const uid = `x${next++}`;
    state.adventurerCards[uid] = { uid, defId: back ? defId.slice(0, -1) : defId, face: back ? "back" : "front", tapped: false, tokens: {} };
    state.players[seat]!.adventurers.push(uid);
    return uid;
  });
}

/** 目前玩家以外的另一位玩家的座位。 */
export function otherSeat(state: GameState): number {
  return state.players.findIndex((p) => p.id !== currentPlayer(state).id);
}

/** 讓目前玩家的暫存格有指定的任務（卡片編號），回傳 uid。 */
export function take(state: GameState, taskId: string): string {
  const uid = `y${next++}`;
  const defKey = [...new CardLibrary(realSource, true).tasks.keys()].find((k) => k.startsWith(`${taskId}｜`))!;
  state.taskCards[uid] = { uid, defKey, attempts: 0, completions: 0 };
  currentPlayer(state).staging.push(uid);
  return uid;
}

export function mission(task: string, dispatched: string[], joined: string[] = []): Mission {
  return { task, dispatched, joined, salary: 0, stage: "assemble", dice: [], pool: 0, removedBy: {}, predictions: {}, baseDice: {}, used: {}, turned: {}, resultDelta: 0, resultTimes: 1, autoSuccess: false, gamble: null };
}

export const run = (state: GameState, lib: CardLibrary, ...actions: Action[]) => actions.reduce((s, a) => applyAction(s, a, lib), state);
