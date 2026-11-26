import { describe, expect, it } from "vitest";
import * as ab from "../src/abilities.js";
import { currentPlayer, type GameState } from "../src/state.js";
import { hire, realGame, run, take } from "./real.js";

/** 派遣並擲骰後，把骰子設成指定的點數，方便測試調整。 */
function rolled(state: GameState, lib: Parameters<typeof run>[1], task: string, party: string[], dice: number[], roll: object = {}) {
  let s = run(state, lib, { type: "dispatch", task, adventurers: party }, { type: "roll", ...roll });
  s = structuredClone(s);
  s.mission!.dice = dice;
  return s;
}

function adventure(): ReturnType<typeof realGame> {
  const g = realGame();
  g.state.phase = "adventure";
  currentPlayer(g.state).gold = 50;
  return g;
}

describe("擲骰前的選擇", () => {
  it("怪盜雞德：必須在擲骰前預言奇偶，預言正確時額外獲得 3 金", () => {
    const { state, lib } = adventure();
    const [kid] = hire(state, "STD-C37");
    const t = take(state, "STD-M04");
    const s = run(state, lib, { type: "dispatch", task: t, adventurers: [kid!] });
    expect(() => run(s, lib, { type: "roll" })).toThrow("預言");
    const r = structuredClone(run(s, lib, { type: "roll", predictions: { [kid!]: "even" } }));
    r.mission!.dice = [5, 5];
    const gold = currentPlayer(r).gold;
    const out = run(r, lib, { type: "resolve" });
    expect(currentPlayer(out).gold).toBe(gold + 7 + 3); // 地磚 ≥9 成功 7 金，加上預言 3 金
  });

  it("古斯：用「加入此次任務」加入時不是派遣，不能自選基礎骰數", () => {
    const { state, lib } = adventure();
    const [leon, goose, rhys] = hire(state, "STD-C21", "STD-C43", "STD-C57");
    const t = take(state, "STD-M04");
    let s = run(state, lib, { type: "dispatch", task: t, adventurers: [leon!] });
    s = run(s, lib, { type: "activate", card: rhys!, skill: "【空間傳送】", targets: [goose!] });
    expect(() => run(s, lib, { type: "roll", baseDice: { [goose!]: 0 } })).toThrow("不能自選基礎骰數");
    expect(run(s, lib, { type: "roll" }).mission!.pool).toBe(1 + 4);
  });

  it("古斯：基礎骰數可以視為 0～4 中的任意數字", () => {
    const { state, lib } = adventure();
    const [goose] = hire(state, "STD-C43");
    const t = take(state, "STD-M07");
    const s = run(state, lib, { type: "dispatch", task: t, adventurers: [goose!] });
    // 視為 0 骰時，骰池至少 1 顆（alpha1.3）
    const zero = run(s, lib, { type: "roll", baseDice: { [goose!]: 0 } });
    expect(zero.mission!.pool).toBe(1);
    expect(zero.log.some((l) => l.text.startsWith("建立骰池：不足 1 顆"))).toBe(true);
    expect(run(s, lib, { type: "roll" }).mission!.pool).toBe(4);
    expect(() => run(s, lib, { type: "roll", baseDice: { [goose!]: 5 } })).toThrow("0～4");
  });
});

describe("擲骰後的調整", () => {
  it("瓦雷諾【老兵】：可以重擲 1 顆骰子，只能用一次", () => {
    const { state, lib } = adventure();
    const [varo] = hire(state, "STD-C20");
    const s = rolled(state, lib, take(state, "STD-M04"), [varo!], [1, 1, 1]);
    expect(ab.adjustOptions(s, lib, s.mission!)).toEqual([{ card: varo, kind: "reroll", remaining: 1, mandatory: false }]);
    expect(() => run(s, lib, { type: "adjust", adjustment: { kind: "reroll", card: varo!, dice: [0, 1] } })).toThrow("最多重擲 1 顆");
    const out = run(s, lib, { type: "adjust", adjustment: { kind: "reroll", card: varo!, dice: [0] } });
    expect(out.mission!.dice.slice(1)).toEqual([1, 1]);
    expect(() => run(out, lib, { type: "adjust", adjustment: { kind: "reroll", card: varo!, dice: [1] } })).toThrow("不能使用");
  });

  it("羅德教授：[聰明] 任務可以轉動至多 2 顆骰子，只能轉到相鄰的面，每顆各 1 次", () => {
    const { state, lib } = adventure();
    const [rod] = hire(state, "STD-C31");
    const s = rolled(state, lib, take(state, "STD-M05"), [rod!], [2, 3]);
    expect(() => run(s, lib, { type: "adjust", adjustment: { kind: "turn", card: rod!, die: 0, face: 5 } })).toThrow("只能轉成");
    let out = run(s, lib, { type: "adjust", adjustment: { kind: "turn", card: rod!, die: 0, face: 6 } });
    expect(out.mission!.dice).toEqual([6, 3]);
    expect(() => run(out, lib, { type: "adjust", adjustment: { kind: "turn", card: rod!, die: 0, face: 5 } })).toThrow("只能轉動 1 次");
    out = run(out, lib, { type: "adjust", adjustment: { kind: "turn", card: rod!, die: 1, face: 5 } });
    expect(out.mission!.dice).toEqual([6, 5]);
    expect(ab.adjustOptions(out, lib, out.mission!)).toEqual([]);
  });

  it("羅德教授在非 [聰明] 任務不能轉動", () => {
    const { state, lib } = adventure();
    const [rod] = hire(state, "STD-C31");
    const s = rolled(state, lib, take(state, "STD-M04"), [rod!], [2, 3]);
    expect(ab.adjustOptions(s, lib, s.mission!)).toEqual([]);
  });

  it("阿特薩：必須先移除 1 顆骰子才能結算", () => {
    const { state, lib } = adventure();
    const [atsa] = hire(state, "STD-C34");
    const s = rolled(state, lib, take(state, "STD-M04"), [atsa!], [2, 6]);
    expect(() => run(s, lib, { type: "resolve" })).toThrow("必須先移除");
    const out = run(s, lib, { type: "adjust", adjustment: { kind: "remove", card: atsa!, die: 0 } });
    expect(out.mission!.dice).toEqual([6]);
    expect(() => run(out, lib, { type: "resolve" })).not.toThrow();
  });

  it("馬文【加注】：任務原本已經成功，加注後仍成功時，獲得重擲數量 × 2 的金幣", () => {
    const { state, lib } = adventure();
    const [marvin, leon] = hire(state, "STD-C46", "STD-C21");
    const t = take(state, "STD-M01"); // 清除史萊姆 ≥5，永久，4 金
    const s = rolled(state, lib, t, [marvin!, leon!], [6, 6]);
    const out = run(s, lib, { type: "adjust", adjustment: { kind: "gamble", card: marvin!, count: 2 } });
    const m = out.mission!;
    const after = structuredClone(out);
    after.mission!.dice = [3, 3]; // 讓重擲結果固定：3+3=6，仍然成功
    const gold = currentPlayer(after).gold;
    const done = run(after, lib, { type: "resolve" });
    expect(m.gamble).toEqual({ uid: marvin, count: 2, successBefore: true });
    expect(currentPlayer(done).gold).toBe(gold + 4 + 4);
  });

  it("馬文【加注】不能用在「X～Y」任務", () => {
    const { state, lib } = adventure();
    const [marvin] = hire(state, "STD-C46");
    const s = rolled(state, lib, take(state, "STD-M05"), [marvin!], [3]);
    expect(ab.adjustOptions(s, lib, s.mission!).some((o) => o.kind === "gamble")).toBe(false);
  });
});
