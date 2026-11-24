import { describe, expect, it } from "vitest";
import * as ab from "../src/abilities.js";
import { gainItem } from "../src/items.js";
import { createDerivative, destroyAdventurer } from "../src/lifecycle.js";
import { currentPlayer, currentPlayerIndex, type GameState } from "../src/state.js";
import { hire, hireFor, otherSeat, realGame, run, take } from "./real.js";

const pass = [{ type: "endGuildPhase" }, { type: "endAdventurePhase" }, { type: "endTurn" }] as const;
const nextSeat = (state: GameState) => (currentPlayerIndex(state) + 1) % state.players.length;

function adventure(): ReturnType<typeof realGame> {
  const g = realGame();
  g.state.phase = "adventure";
  g.state.turnStartOpen = false;
  currentPlayer(g.state).gold = 20;
  return g;
}

describe("瑪絲珂與小嗶", () => {
  it("被招募時從 8 種小嗶中選 3 張不同的放進工作室；創造小嗶時可以轉移精工指示物", () => {
    let { state, lib } = realGame();
    state.adventurerCards["m"] = { uid: "m", defId: "STD-C18", face: "front", tapped: false, tokens: { 精工: 4 } };
    state.tavern[0] = "m";
    state = run(state, lib, { type: "recruit", tavernIndex: 0 });
    expect(state.pending).toMatchObject({ kind: "chooseWorkshop", count: 3 });
    expect((state.pending as { options: string[] }).options).toHaveLength(8);
    state = run(state, lib, { type: "decide", decision: { option: "workshop", names: ["重拳小嗶", "飛天小嗶", "狗狗小嗶"] } });
    expect(state.adventurerCards["m"]!.workshop).toEqual(["重拳小嗶", "飛天小嗶", "狗狗小嗶"]);
    state.phase = "adventure";
    state = run(state, lib, { type: "activate", card: "m", skill: "【小嗶！出動！】", derivative: "重拳小嗶", count: 3 });
    const bot = currentPlayer(state).adventurers.find((u) => state.adventurerCards[u]!.derivative)!;
    expect(state.adventurerCards[bot]!.tokens).toEqual({ 精工: 3 });
    expect(state.adventurerCards["m"]!.tokens).toEqual({ 精工: 1 });
    expect(state.adventurerCards["m"]!.workshop).toEqual(["飛天小嗶", "狗狗小嗶"]);
    expect(ab.capacityUsed(state, lib, currentPlayer(state))).toBe(1); // 衍生物不佔容量
  });

  it("重拳小嗶：每個精工指示物骰數 +1；輪末被銷毀", () => {
    let { state, lib } = adventure();
    const owner = currentPlayer(state).id;
    const bot = createDerivative(state, lib, currentPlayer(state), "重拳小嗶", () => {}, { 精工: 3 })!;
    const t = take(state, "STD-M04");
    const s = run(state, lib, { type: "dispatch", task: t, adventurers: [bot] }, { type: "roll" });
    expect(s.mission!.pool).toBe(3);
    state = run(state, lib, { type: "endAdventurePhase" }, { type: "endTurn" }, ...pass, ...pass, ...pass);
    expect(state.players.find((p) => p.id === owner)!.adventurers).toEqual([]);
  });

  it("飛天小嗶：橫置基礎骰數低於（精工 ÷ 2）的冒險者", () => {
    const { state, lib } = adventure();
    const bot = createDerivative(state, lib, currentPlayer(state), "飛天小嗶", () => {}, { 精工: 4 })!;
    const [low, high] = hireFor(state, otherSeat(state), "STD-C21", "STD-C23");
    expect(() => run(state, lib, { type: "activate", card: bot, skill: "【從天而降的掌法！】", targets: [high!] })).toThrow("不低於 2");
    const out = run(state, lib, { type: "activate", card: bot, skill: "【從天而降的掌法！】", targets: [low!] });
    expect(out.adventurerCards[low!]!.tapped).toBe(true);
  });

  it("狗狗小嗶：把精工指示物轉移給另一名 [機械] 冒險者，然後被銷毀", () => {
    const { state, lib } = adventure();
    const p = currentPlayer(state);
    const dog = createDerivative(state, lib, p, "狗狗小嗶", () => {}, { 精工: 2 })!;
    const punch = createDerivative(state, lib, p, "重拳小嗶", () => {}, { 精工: 1 })!;
    const out = run(state, lib, { type: "activate", card: dog, skill: "【咬去給他！】", targets: [punch] });
    expect(out.adventurerCards[punch]!.tokens).toEqual({ 精工: 3 });
    expect(out.adventurerCards[dog]).toBeUndefined();
  });
});

describe("和弦的回合開始與結算效果", () => {
  it("彌的和弦：回合開始時創造 2 個彌的粉絲；和彌一起出任務時骰數 +1、獲得 3 金，結算後銷毀", () => {
    let { state, lib } = realGame();
    const seat = nextSeat(state);
    const [mi] = hireFor(state, seat, "STD-C50", "STD-C52", "STD-C54");
    state = run(state, lib, ...pass);
    const p = currentPlayer(state);
    const fans = p.adventurers.filter((u) => state.adventurerCards[u]!.derivative);
    expect(fans).toHaveLength(2);
    state.phase = "adventure";
    p.gold = 20;
    const t = take(state, "STD-M04");
    let s = run(state, lib, { type: "dispatch", task: t, adventurers: [mi!, ...fans] }, { type: "roll" });
    expect(s.mission!.pool).toBe(2 + 1 + 1);
    expect(currentPlayer(s).gold).toBe(20 - 2 + 6);
    s = run(s, lib, { type: "resolve" });
    expect(currentPlayer(s).adventurers.filter((u) => s.adventurerCards[u]?.derivative)).toEqual([]);
  });

  it("蕾的和弦：回合開始時可以把一個任務的時限 +1", () => {
    let { state, lib } = realGame();
    const seat = nextSeat(state);
    hireFor(state, seat, "STD-C49", "STD-C51", "STD-C53");
    const t = take(state, "STD-M04");
    currentPlayer(state).staging = [];
    state.players[seat]!.formal.push({ uid: t, timer: 1 });
    state = run(state, lib, ...pass);
    expect(state.pending).toMatchObject({ kind: "extendTask", candidates: [t] });
    state = run(state, lib, { type: "decide", decision: { option: "task", target: t } });
    expect(currentPlayer(state).formal[0]!.timer).toBe(2);
  });

  it("汐的和弦：完成任務後可以重置 1 名冒險者", () => {
    const { state, lib } = adventure();
    const [, , , leon] = hire(state, "STD-C54", "STD-C49", "STD-C51", "STD-C21");
    const t = take(state, "STD-M01");
    const s = structuredClone(run(state, lib, { type: "dispatch", task: t, adventurers: [leon!] }, { type: "roll" }));
    s.mission!.dice = [6];
    let out = run(s, lib, { type: "resolve" });
    expect(out.pending).toMatchObject({ kind: "resetAdventurers", count: 1, candidates: [leon] });
    out = run(out, lib, { type: "decide", decision: { option: "reset", targets: [leon!] } });
    expect(out.adventurerCards[leon!]!.tapped).toBe(false);
  });
});

describe("銷毀", () => {
  it("梅里妲的注視：持有者聲望下降時，銷毀自己的一名冒險者，再銷毀注視；艾里克 +2 聲望", () => {
    let { state, lib } = adventure();
    const p = currentPlayer(state);
    const [leon] = hire(state, "STD-C21");
    const [eric] = hireFor(state, otherSeat(state), "STD-C42");
    gainItem(state, lib, p, "梅里妲的注視", () => {});
    p.reputation = 2;
    const black = hire(state, "STD-C02")[0]!;
    state.adventurerCards[black]!.tapped = true;
    // 用永久任務的負聲望獎勵讓聲望下降：直接以下水道裡的交易（−1 聲望）測試
    const t = take(state, "STD-M17");
    let s = structuredClone(run(state, lib, { type: "dispatch", task: t, adventurers: [leon!] }, { type: "roll" }));
    s.mission!.dice = [1];
    s = run(s, lib, { type: "resolve" });
    expect(currentPlayer(s).reputation).toBe(1);
    expect(s.pending).toMatchObject({ kind: "destroyOwn", candidates: [leon, black] });
    s = run(s, lib, { type: "decide", decision: { option: "destroy", target: black } });
    expect(currentPlayer(s).adventurers).toEqual([leon]);
    expect(s.destroyed).toContain(black);
    expect(currentPlayer(s).items).toEqual([]);
    expect(s.players[otherSeat(s)]!.reputation).toBe(2);
    void eric;
  });

  it("瓦雷諾：[王國] 冒險者將被銷毀時，可以改為銷毀瓦雷諾", () => {
    const { state, lib } = adventure();
    const [varo, leon] = hire(state, "STD-C20", "STD-C21");
    destroyAdventurer(state, lib, leon!, () => {});
    expect(state.pending).toMatchObject({ kind: "confirmReplace", what: "adventurer", target: leon, replacement: varo });
    const yes = run(state, lib, { type: "decide", decision: { option: "yes" } });
    expect(currentPlayer(yes).adventurers).toEqual([leon]);
    const no = run(state, lib, { type: "decide", decision: { option: "no" } });
    expect(currentPlayer(no).adventurers).toEqual([varo]);
  });

  it("戈拉古斯的手稿：【獨特】道具將被銷毀時，可以改為銷毀手稿", () => {
    const { state, lib } = adventure();
    const p = currentPlayer(state);
    const [leon] = hire(state, "STD-C21");
    gainItem(state, lib, p, "梅里妲的注視", () => {});
    gainItem(state, lib, p, "戈拉古斯的手稿", () => {});
    p.reputation = 1;
    state.pending = { kind: "destroyOwn", player: p.id, source: p.items[0]!, candidates: [leon!] };
    let s = run(state, lib, { type: "decide", decision: { option: "destroy", target: leon! } });
    expect(s.pending).toMatchObject({ kind: "confirmReplace", what: "item" });
    s = run(s, lib, { type: "decide", decision: { option: "yes" } });
    expect(currentPlayer(s).items.map((u) => s.itemCards[u]!.name)).toEqual(["梅里妲的注視"]);
  });
});
