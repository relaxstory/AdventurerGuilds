import { describe, expect, it } from "vitest";
import { adventurerCapacity, applyAction, stagingSlots, type Action } from "../src/actions.js";
import { itemSlots } from "../src/items.js";
import type { CardLibrary } from "../src/defs.js";
import { RuleError } from "../src/errors.js";
import { currentPlayer, type GameState } from "../src/state.js";
import { adv, setup, source, task } from "./fixture.js";

const run = (state: GameState, lib: CardLibrary, ...actions: Action[]) => actions.reduce((s, a) => applyAction(s, a, lib), state);
/** 完整的一次派遣：派遣 → 擲骰 → 結算。 */
const go = (task: string, adventurers: string[]): Action[] => [{ type: "dispatch", task, adventurers }, { type: "roll" }, { type: "resolve" }];

/** 讓目前玩家直接擁有指定的冒險者與任務（略過招募與接取）。 */
function give(state: GameState, adventurers: number, tasks: string[] = []): GameState {
  const s = structuredClone(state);
  const p = currentPlayer(s);
  p.adventurers.push(...s.tavern.splice(0, adventurers));
  for (const key of tasks) {
    const uid = Object.values(s.taskCards).find((t) => t.defKey.startsWith(key))!.uid;
    s.board = s.board.map((b) => (b === uid ? null : b));
    s.taskDeck = s.taskDeck.filter((t) => t !== uid);
    p.staging.push(uid);
  }
  return s;
}

describe("公會階段", () => {
  it("招募不花錢，花 1 次行動；酒館依序遞補並從牌庫補到末端", () => {
    const { state, lib } = setup();
    const before = [...state.tavern];
    const next = state.adventurerDeck[0];
    const s = run(state, lib, { type: "recruit", tavernIndex: 1 });
    const p = currentPlayer(s);
    expect(p.adventurers).toEqual([before[1]]);
    expect(p.gold).toBe(5);
    expect(p.actionsLeft).toBe(2);
    expect(s.tavern).toEqual([before[0], before[2], before[3], before[4], next]);
  });

  it("替換時，被解僱的冒險者放進被招募者原本的位置", () => {
    const { state, lib } = setup();
    let s = run(state, lib, { type: "recruit", tavernIndex: 0 });
    const fired = currentPlayer(s).adventurers[0]!;
    const target = s.tavern[2]!;
    s = run(s, lib, { type: "recruit", tavernIndex: 2, replace: fired });
    expect(currentPlayer(s).adventurers).toEqual([target]);
    expect(s.tavern[2]).toBe(fired);
  });

  it("冒險者已滿 5 名時，必須選擇要解僱的冒險者", () => {
    const { state, lib } = setup();
    const s = give(state, 5);
    currentPlayer(s).actionsLeft = 3;
    s.tavern.push(...s.adventurerDeck.splice(0, 5));
    expect(() => run(s, lib, { type: "recruit", tavernIndex: 0 })).toThrow(RuleError);
  });

  it("3 次公會行動用完後不能再招募或接任務", () => {
    const { state, lib } = setup();
    const s = run(state, lib, ...[0, 0, 0].map((i) => ({ type: "recruit", tavernIndex: i }) as Action));
    expect(() => run(s, lib, { type: "recruit", tavernIndex: 0 })).toThrow("公會行動已經用完");
  });

  it("接任務需要空的暫存格，初始只有 1 格", () => {
    const { state, lib } = setup();
    const s = run(state, lib, { type: "acceptTask", boardIndex: 0 });
    expect(currentPlayer(s).staging).toHaveLength(1);
    expect(s.board[0]).toBeNull();
    expect(() => run(s, lib, { type: "acceptTask", boardIndex: 1 })).toThrow("任務暫存格已滿");
  });
});

describe("冒險階段", () => {
  const sure = source({
    adventurers: Array.from({ length: 10 }, (_, i) => adv(`C${i}`, 2, 2)),
    tasks: [
      task("OK", "一般", { op: "atLeast", x: 1 }, 6, 1),
      task("NO", "一般", { op: "atLeast", x: 99 }, 6, 1),
      task("P", "永久", { op: "atLeast", x: 1 }, 2),
      ...Array.from({ length: 10 }, (_, i) => task(`F${i}`, "一般", { op: "atLeast", x: 5 }, 4)),
    ],
  });

  const ready = (tasks: string[], adventurers = 2) => {
    const { state, lib } = setup({}, sure);
    const s = give(state, adventurers, tasks);
    s.phase = "adventure";
    return { s, lib };
  };

  it("擲骰前支付薪資並橫置；成功時獲得獎勵，任務移到完成區", () => {
    const { s, lib } = ready(["OK"]);
    const p = currentPlayer(s);
    const t = p.staging[0]!;
    const out = run(s, lib, ...go(t, [p.adventurers[0]!]));
    const q = currentPlayer(out);
    expect(q.gold).toBe(5 - 2 + 6);
    expect(q.reputation).toBe(1);
    expect(q.completed).toEqual([t]);
    expect(out.adventurerCards[p.adventurers[0]!]!.tapped).toBe(true);
    expect(out.log.at(-1)!.dice).toHaveLength(2);
  });

  it("失敗時放上嘗試指示物，同一回合可以再派其他冒險者嘗試", () => {
    const { s, lib } = ready(["NO"]);
    const p = currentPlayer(s);
    const t = p.staging[0]!;
    let out = run(s, lib, ...go(t, [p.adventurers[0]!]));
    expect(out.taskCards[t]!.attempts).toBe(1);
    out = run(out, lib, ...go(t, [p.adventurers[1]!]));
    expect(out.taskCards[t]!.attempts).toBe(2);
    expect(currentPlayer(out).gold).toBe(1);
  });

  it("金幣不夠付薪資時不能派遣；橫置的冒險者不能派遣", () => {
    const { s, lib } = ready(["NO"]);
    const p = currentPlayer(s);
    p.gold = 1;
    expect(() => run(s, lib, ...go(p.staging[0]!, [p.adventurers[0]!]))).toThrow("金幣不足");
    p.gold = 5;
    const out = run(s, lib, ...go(p.staging[0]!, [p.adventurers[0]!]));
    expect(() => run(out, lib, ...go(p.staging[0]!, [p.adventurers[0]!]))).toThrow("已經橫置");
  });

  it("永久任務完成後留下來，放完成指示物，不進任務完成區", () => {
    const { s, lib } = ready(["P"]);
    const p = currentPlayer(s);
    const t = p.staging[0]!;
    let out = run(s, lib, ...go(t, [p.adventurers[0]!]));
    out = run(out, lib, ...go(t, [p.adventurers[1]!]));
    expect(out.taskCards[t]!.completions).toBe(2);
    expect(currentPlayer(out).completed).toEqual([]);
    expect(currentPlayer(out).staging).toEqual([t]);
  });

  it("王國不信任：完成任務時先依層數扣報酬，再消除 1 層", () => {
    const { s, lib } = ready(["OK"]);
    const p = currentPlayer(s);
    p.distrust = 2;
    const out = run(s, lib, ...go(p.staging[0]!, [p.adventurers[0]!]));
    expect(currentPlayer(out).gold).toBe(5 - 2 + (6 - 2));
    expect(currentPlayer(out).distrust).toBe(1);
  });
});

describe("公會整理階段", () => {
  /** 從冒險階段進入公會整理階段（會處理時限與逾期）。 */
  const toCleanup = (s: GameState, lib: CardLibrary) => {
    const c = structuredClone(s);
    c.phase = "adventure";
    return run(c, lib, { type: "endAdventurePhase" });
  };

  it("暫存格的任務依類型移入正式任務區：一般 [3]、緊急 [1]、永久 [∞]", () => {
    const { state, lib } = setup();
    const out = toCleanup(give(state, 0, ["M1", "U1", "P1"]), lib);
    const p = currentPlayer(out);
    expect(p.formal.map((f) => f.timer)).toEqual([3, 1, null]);
    expect(p.staging).toEqual([]);
  });

  it("時限減到 0 時逾期；沒有嘗試過的任務累積王國不信任", () => {
    const { state, lib } = setup();
    const s = structuredClone(state);
    const uid = s.board[0]!;
    currentPlayer(s).formal.push({ uid, timer: 1 });
    s.board[0] = null;
    const out = toCleanup(s, lib);
    const q = currentPlayer(out);
    expect(q.formal).toEqual([]);
    expect(q.gold).toBe(5 - 2); // 聲望為 0，只能扣獎勵一半（4 → 2 金）
    expect(q.distrust).toBe(1);
    expect(out.taskDiscard).toContain(uid);
  });

  it("永久任務不會逾期", () => {
    const { state, lib } = setup();
    let s = toCleanup(give(state, 0, ["P1"]), lib);
    for (let i = 0; i < 5; i++) {
      s.phase = "adventure";
      s = run(s, lib, { type: "endAdventurePhase" });
    }
    expect(currentPlayer(s).formal.map((f) => f.timer)).toEqual([null]);
  });

  it("金幣與聲望都能付時，必須由玩家選擇；有嘗試過就不累積不信任", () => {
    const { state, lib } = setup();
    const s = structuredClone(state);
    const p = currentPlayer(s);
    const uid = s.board[0]!;
    p.formal.push({ uid, timer: 1 });
    p.reputation = 3;
    s.taskCards[uid]!.attempts = 1;
    const waiting = toCleanup(s, lib);
    expect(waiting.pendingExpiry).toEqual([uid]);
    expect(() => run(waiting, lib, { type: "endTurn" })).toThrow("逾期懲罰");
    const out = run(waiting, lib, { type: "choosePenalty", task: uid, penalty: "reputation" });
    const q = currentPlayer(out);
    expect(q.reputation).toBe(2);
    expect(q.gold).toBe(5);
    expect(q.distrust).toBe(0);
    expect(out.pendingExpiry).toEqual([]);
  });

  it("二階公會：三種加成各 +1 格", () => {
    const { state, lib } = setup();
    const s = toCleanup(state, lib);
    currentPlayer(s).completed = ["x1", "x2", "x3", "x4"];
    const before = currentPlayer(s);
    expect([stagingSlots(before), adventurerCapacity(before), itemSlots(s, lib, before)]).toEqual([1, 5, 3]);
    const a = currentPlayer(run(s, lib, { type: "upgrade", bonus: "adventurer" }));
    expect([stagingSlots(a), adventurerCapacity(a)]).toEqual([1, 6]);
    const t = currentPlayer(run(s, lib, { type: "upgrade", bonus: "staging" }));
    expect([stagingSlots(t), adventurerCapacity(t)]).toEqual([2, 5]);
    const i = run(s, lib, { type: "upgrade", bonus: "item" });
    expect(itemSlots(i, lib, currentPlayer(i))).toBe(4);
  });

  it("升級方案（試驗）：冒險者格 +2、專精、付費格子", () => {
    const make = (upgradeVariant: "adventurer2" | "specialize" | "paid") => {
      const { state, lib } = setup();
      (state as { config: unknown }).config = { ...state.config, upgradeVariant };
      const s = toCleanup(state, lib);
      currentPlayer(s).completed = ["x1", "x2", "x3", "x4"];
      return { s, lib };
    };
    const a = make("adventurer2");
    expect(adventurerCapacity(currentPlayer(run(a.s, a.lib, { type: "upgrade", bonus: "adventurer" })))).toBe(7);
    const b = make("specialize");
    expect(() => run(b.s, b.lib, { type: "upgrade", bonus: "staging" })).toThrow("專精");
    const t = currentPlayer(run(b.s, b.lib, { type: "upgrade", bonus: "task" }));
    expect([stagingSlots(t), t.upgradePerks?.timer, t.upgradePerks?.extraAttempt]).toEqual([2, 1, 1]);
    const c = make("paid");
    const out = run(c.s, c.lib, { type: "upgrade", bonus: "staging" });
    const p = currentPlayer(out);
    expect([stagingSlots(p), p.upgradePerks?.paidExtra]).toEqual([2, 2]);
  });

  it("升級費用：完成 4 項任務免費；|聲望| ≥ 5 為 3 金；否則 7 金", () => {
    const { state, lib } = setup();
    const s = toCleanup(state, lib);
    const p = currentPlayer(s);
    expect(() => run(s, lib, { type: "upgrade", bonus: "staging" })).toThrow("升級需要 7 金");
    p.reputation = -5;
    expect(currentPlayer(run(s, lib, { type: "upgrade", bonus: "staging" }))).toMatchObject({ gold: 2, upgraded: true, upgradeBonus: "staging" });
    p.reputation = 0;
    p.completed = ["x1", "x2", "x3", "x4"];
    const out = run(s, lib, { type: "upgrade", bonus: "staging" });
    expect(currentPlayer(out)).toMatchObject({ gold: 5, upgraded: true });
    expect(() => run(out, lib, { type: "upgrade", bonus: "item" })).toThrow("已經是二階公會");
  });
});

describe("回合與輪末", () => {
  const passTurn: Action[] = [{ type: "endGuildPhase" }, { type: "endAdventurePhase" }, { type: "endTurn" }];

  it("4 位玩家各進行一個回合後輪末結算：重置、公告欄換新、酒館移除最前端 2 名、起始玩家輪替", () => {
    const { state, lib } = setup();
    let s = run(state, lib, { type: "recruit", tavernIndex: 0 });
    const recruited = currentPlayer(s).adventurers[0]!;
    s.adventurerCards[recruited]!.tapped = true;
    const tavern = [...s.tavern];
    const deckTop = s.taskDeck.slice(0, 5);
    const start = s.startPlayer;
    s = run(s, lib, ...passTurn, ...passTurn, ...passTurn, ...passTurn);
    expect(s.round).toBe(2);
    expect(s.startPlayer).toBe((start + 1) % 4);
    expect(s.adventurerCards[recruited]!.tapped).toBe(false);
    expect(s.board).toEqual(deckTop);
    expect(s.tavern.slice(0, 3)).toEqual(tavern.slice(2));
    expect(s.adventurerDiscard).toEqual(tavern.slice(0, 2));
  });

  it("第 8 輪結束後遊戲結束並計分", () => {
    const { state, lib } = setup({ rounds: 1 });
    const s = run(state, lib, ...passTurn, ...passTurn, ...passTurn, ...passTurn);
    expect(s.phase).toBe("gameOver");
    expect(s.result).not.toBeNull();
    expect(() => run(s, lib, { type: "endGuildPhase" })).toThrow("遊戲已經結束");
  });

  it("不合法的操作不會改動原本的狀態", () => {
    const { state, lib } = setup();
    const copy = structuredClone(state);
    expect(() => run(state, lib, ...go("t1", []))).toThrow(RuleError);
    expect(state).toEqual(copy);
  });
});
