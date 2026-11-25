import { describe, expect, it } from "vitest";
import { gainItem, itemSlots, sellPrice } from "../src/items.js";
import { currentPlayer, type GameState } from "../src/state.js";
import { hire, hireFor, otherSeat, realGame, run, take } from "./real.js";

const give = (state: GameState, lib: Parameters<typeof run>[1], ...names: string[]) =>
  names.map((n) => gainItem(state, lib, currentPlayer(state), n, () => {})!);
const names = (state: GameState) => currentPlayer(state).items.map((u) => state.itemCards[u]!.name);

function adventure(): ReturnType<typeof realGame> {
  const g = realGame();
  g.state.phase = "adventure";
  g.state.turnStartOpen = false;
  currentPlayer(g.state).gold = 20;
  return g;
}

describe("取得與道具區", () => {
  it("道具區 2 格（一階公會），超過時必須捨棄一個（可以捨棄新拿到的）", () => {
    const { state, lib } = realGame();
    const [a, b] = give(state, lib, "小麥", "牛乳");
    expect(state.pending).toBeNull();
    const [c] = give(state, lib, "鹿腿肉");
    expect(state.pending).toMatchObject({ kind: "discardItem", items: [a, b, c] });
    const out = run(state, lib, { type: "decide", decision: { option: "discard", target: c! } });
    expect(names(out)).toEqual(["小麥", "牛乳"]);
  });

  it("[狀態] 道具不佔道具格，也不能出售", () => {
    const { state, lib } = realGame();
    give(state, lib, "小麥", "牛乳", "火爪的信念");
    expect(state.pending).toBeNull();
    state.phase = "cleanup";
    const faith = currentPlayer(state).items[2]!;
    expect(() => run(state, lib, { type: "sell", item: faith })).toThrow("不能出售");
  });

  it("法的和弦：道具格 +1", () => {
    const { state, lib } = realGame();
    hire(state, "STD-C51", "STD-C53", "STD-C48");
    expect(itemSlots(state, lib, currentPlayer(state))).toBe(3);
  });

  it("【獨特】道具整場只有一份：芙蕾雅被招募時獲得父親的家書，第二次拿不到", () => {
    let { state, lib } = realGame();
    for (const uid of ["f1", "f2"]) state.adventurerCards[uid] = { uid, defId: "STD-C29", face: "front", tapped: false, tokens: {} };
    state.tavern[0] = "f1";
    state = run(state, lib, { type: "recruit", tavernIndex: 0 });
    expect(names(state)).toEqual(["父親的家書"]);
    state.tavern[0] = "f2";
    state = run(state, lib, { type: "recruit", tavernIndex: 0 });
    expect(names(state)).toEqual(["父親的家書"]);
  });

  it("父親的家書：持有時，芙蕾雅每輪第一次派遣不需橫置", () => {
    const { state, lib } = adventure();
    const [freya] = hire(state, "STD-C29");
    give(state, lib, "父親的家書");
    const t = take(state, "STD-M01");
    const out = run(state, lib, { type: "dispatch", task: t, adventurers: [freya!] });
    expect(out.adventurerCards[freya!]!.tapped).toBe(false);
  });

  it("出售價格：漢克【農莊加工】讓 [乳製品] 與 [農產品] 售價 +2", () => {
    const { state, lib } = realGame();
    const [milk, hide] = give(state, lib, "牛乳", "獸皮");
    const p = currentPlayer(state);
    expect(sellPrice(state, lib, p, milk!)).toBe(1);
    hire(state, "STD-C60");
    expect(sellPrice(state, lib, p, milk!)).toBe(3);
    expect(sellPrice(state, lib, p, hide!)).toBe(2);
    state.phase = "cleanup";
    const out = run(state, lib, { type: "sell", item: milk! });
    expect(currentPlayer(out).gold).toBe(5 + 3);
  });
});

describe("製作與轉換", () => {
  it("伊蓮娜：公會階段銷毀兩個 [藥材]，獲得一種藥劑", () => {
    const { state, lib } = realGame();
    state.turnStartOpen = false;
    const [elena] = hire(state, "STD-C27");
    give(state, lib, "紅斑菌菇");
    const skill = "【加一點這個，然後是這個……】";
    expect(() => run(state, lib, { type: "activate", card: elena!, skill, item: "伊蓮娜的強壯藥劑" })).toThrow("需要 2 個 [藥材]");
    give(state, lib, "紅斑菌菇");
    const out = run(state, lib, { type: "activate", card: elena!, skill, item: "伊蓮娜的強壯藥劑" });
    expect(names(out)).toEqual(["伊蓮娜的強壯藥劑"]);
    const adv = structuredClone(state);
    adv.phase = "adventure";
    expect(() => run(adv, lib, { type: "activate", card: elena!, skill, item: "伊蓮娜的強壯藥劑" })).toThrow("只能在公會階段");
  });

  it("漢克【農產加工】：消耗至多 2 個 [農產品]，創造等量的漢克的貨品", () => {
    const { state, lib } = adventure();
    const [hank] = hire(state, "STD-C60");
    give(state, lib, "小麥", "牛乳");
    const out = run(state, lib, { type: "activate", card: hank!, skill: "【農產加工】", count: 2 });
    expect(names(out).sort()).toEqual(["漢克的貨品", "漢克的貨品"].sort());
  });

  it("傑米【看我的傑作！】：創造希氏炸藥並轉移精工指示物；炸藥在擲骰後使用", () => {
    const { state, lib } = adventure();
    const [jamie, leon] = hire(state, "STD-C41", "STD-C21");
    state.adventurerCards[jamie!]!.tokens = { 精工: 5 };
    let s = run(state, lib, { type: "activate", card: jamie!, skill: "【看我的傑作！】" });
    const bomb = currentPlayer(s).items[0]!;
    expect(s.itemCards[bomb]).toMatchObject({ name: "希氏炸藥", tokens: { 精工: 5 } });
    expect(s.adventurerCards[jamie!]!.tokens).toEqual({});
    const t = take(s, "STD-M04");
    s = run(s, lib, { type: "dispatch", task: t, adventurers: [leon!] });
    expect(() => run(s, lib, { type: "useItem", item: bomb })).toThrow("只能在擲骰後使用");
    s = run(s, lib, { type: "roll" }, { type: "useItem", item: bomb });
    expect(s.mission!.resultDelta).toBe(5); // 4～6 個指示物：骰子總和 +5
  });
});

describe("使用道具", () => {
  it("強壯藥劑：在冒險階段、派遣流程以外使用，本輪基礎骰數 +2；派遣流程中不能使用", () => {
    const { state, lib } = adventure();
    const [leon] = hire(state, "STD-C21");
    const [potion] = give(state, lib, "伊蓮娜的強壯藥劑");
    const t = take(state, "STD-M04");
    const inMission = run(state, lib, { type: "dispatch", task: t, adventurers: [leon!] });
    expect(() => run(inMission, lib, { type: "useItem", item: potion!, targets: [leon!] })).toThrow("派遣流程以外");
    const guild = structuredClone(state);
    guild.phase = "guild";
    expect(() => run(guild, lib, { type: "useItem", item: potion!, targets: [leon!] })).toThrow("冒險階段");
    const s = run(state, lib, { type: "useItem", item: potion!, targets: [leon!] }, { type: "dispatch", task: t, adventurers: [leon!] }, { type: "roll" });
    expect(s.mission!.pool).toBe(1 + 2);
  });

  it("紅斑菌菇：可以對對手的冒險者使用，本輪基礎骰數 −1，輪末無法重置", () => {
    const { state, lib } = adventure();
    const [leon] = hire(state, "STD-C21");
    const [foe] = hireFor(state, otherSeat(state), "STD-C23");
    const [shroom] = give(state, lib, "紅斑菌菇");
    const t = take(state, "STD-M04");
    let s = run(state, lib, { type: "useItem", item: shroom!, targets: [foe!] }, { type: "dispatch", task: t, adventurers: [leon!] });
    expect(s.adventurerCards[foe!]!.roundBaseDelta).toEqual({ round: 1, delta: -1 });
    s.adventurerCards[foe!]!.tapped = true;
    s = run(s, lib, { type: "roll" }, { type: "resolve" }, { type: "endAdventurePhase" }, { type: "endTurn" });
    for (let i = 0; i < 3; i++) s = run(s, lib, { type: "endGuildPhase" }, { type: "endAdventurePhase" }, { type: "endTurn" });
    expect(s.round).toBe(2);
    expect(s.adventurerCards[foe!]!.tapped).toBe(true);
  });

  it("道具只能在冒險階段、派遣流程以外使用（希氏炸藥除外）", () => {
    const { state, lib } = adventure();
    const [leon] = hire(state, "STD-C21");
    const [potion] = give(state, lib, "伊蓮娜的精力藥劑");
    const guild = structuredClone(state);
    guild.phase = "guild";
    expect(() => run(guild, lib, { type: "useItem", item: potion!, targets: [leon!] })).toThrow("冒險階段");
  });

  it("精力藥劑：重置一名冒險者", () => {
    const { state, lib } = adventure();
    const [leon] = hire(state, "STD-C21");
    state.adventurerCards[leon!]!.tapped = true;
    const [potion] = give(state, lib, "伊蓮娜的精力藥劑");
    expect(run(state, lib, { type: "useItem", item: potion!, targets: [leon!] }).adventurerCards[leon!]!.tapped).toBe(false);
  });

  it("火爪的信念：消耗所有信念，3 個以上聲望 +4、金幣 +2", () => {
    const { state, lib } = adventure();
    const [f] = give(state, lib, "火爪的信念", "火爪的信念", "火爪的信念");
    const out = run(state, lib, { type: "useItem", item: f! });
    expect(currentPlayer(out)).toMatchObject({ reputation: 4, gold: 22, items: [] });
  });
});

describe("觸發取得道具", () => {
  it("老約翰：完成 [森林] 任務時，可以選擇一種材料（也可以不拿）", () => {
    const { state, lib } = adventure();
    const [john] = hire(state, "STD-C23");
    const t = take(state, "STD-M14");
    const s = structuredClone(run(state, lib, { type: "dispatch", task: t, adventurers: [john!] }, { type: "roll" }));
    s.mission!.dice = [6, 6, 6];
    const out = run(s, lib, { type: "resolve" });
    expect(out.pending).toMatchObject({ kind: "chooseItem", options: ["鹿腿肉", "紅斑菌菇", "獸皮"], optional: true });
    expect(names(run(out, lib, { type: "decide", decision: { option: "item", name: "獸皮" } }))).toEqual(["獸皮"]);
    expect(names(run(out, lib, { type: "decide", decision: { option: "skip" } }))).toEqual([]);
  });

  it("薩姆【野火蔓延】：其他玩家完成 [森林] 任務時，薩姆的擁有者也可以拿道具", () => {
    const { state, lib } = adventure();
    const seat = otherSeat(state);
    hireFor(state, seat, "STD-C45");
    const [leon] = hire(state, "STD-C21");
    const t = take(state, "STD-M14");
    const s = structuredClone(run(state, lib, { type: "dispatch", task: t, adventurers: [leon!] }, { type: "roll" }));
    s.mission!.dice = [6];
    const out = run(s, lib, { type: "resolve" });
    expect(out.pending).toMatchObject({ kind: "chooseItem", player: state.players[seat]!.id, options: ["火爪的信念", "灰燼"] });
  });

  it("比爾：回合結束時獲得 1 個小麥，若直立再額外 1 個", () => {
    const { state, lib } = adventure();
    hire(state, "STD-C59");
    const owner = currentPlayer(state).id;
    const out = run(state, lib, { type: "endAdventurePhase" }, { type: "endTurn" });
    expect(out.players.find((p) => p.id === owner)!.items.map((u) => out.itemCards[u]!.name)).toEqual(["小麥", "小麥"]);
  });

  it("梅里妲：被招募時，把梅里妲的注視放在另一位玩家面前（不佔道具格）", () => {
    let { state, lib } = realGame();
    state.adventurerCards["m1"] = { uid: "m1", defId: "STD-C44", face: "front", tapped: false, tokens: {} };
    state.tavern[0] = "m1";
    state = run(state, lib, { type: "recruit", tavernIndex: 0 });
    const other = state.players[otherSeat(state)]!;
    expect(state.pending).toMatchObject({ kind: "givePlayer", item: "梅里妲的注視" });
    state = run(state, lib, { type: "decide", decision: { option: "player", target: other.id } });
    const q = state.players.find((p) => p.id === other.id)!;
    expect(q.items.map((u) => state.itemCards[u]!.name)).toEqual(["梅里妲的注視"]);
  });
});

describe("兜的和弦", () => {
  it("湊齊彌與梭時，擲骰後可以銷毀 1 個 [食材]，使任務視為成功", () => {
    const { state, lib } = adventure();
    const [, , , leon] = hire(state, "STD-C48", "STD-C50", "STD-C52", "STD-C21");
    give(state, lib, "小麥");
    const t = take(state, "STD-M04");
    const s = structuredClone(run(state, lib, { type: "dispatch", task: t, adventurers: [leon!] }, { type: "roll" }));
    s.mission!.dice = [1];
    const frog = currentPlayer(s).adventurers[0]!;
    const out = run(s, lib, { type: "adjust", adjustment: { kind: "autoSuccess", card: frog } }, { type: "resolve" });
    expect(currentPlayer(out).completed).toEqual([t]);
    expect(currentPlayer(out).items).toEqual([]);
  });
});

describe("排隊中的道具捨棄", () => {
  it("輪到時依目前的道具重新判斷：先前的捨棄已經解決超量，就略過", async () => {
    const { realGame } = await import("./real.js");
    const { gainItem } = await import("../src/items.js");
    const { decide } = await import("../src/activate.js");
    const { currentPlayer } = await import("../src/state.js");
    const { state, lib } = realGame();
    const p = currentPlayer(state);
    const names = [...lib.items.keys()].filter((n) => !lib.item(n).categories.some((c) => c.includes("狀態")) && !lib.item(n).categories.some((c) => c.includes("獨特")));
    for (const n of names.slice(0, 2)) gainItem(state, lib, p, n, () => {});
    gainItem(state, lib, p, names[2]!, () => {}); // 第 3 種：超過 2 格，需要捨棄
    gainItem(state, lib, p, names[3]!, () => {}); // 第 4 種：排隊
    expect(state.pending?.kind).toBe("discardItem");
    expect(state.pendingQueue).toHaveLength(1);
    // 第一次捨棄後仍超量 → 第二次捨棄的清單要是目前的道具
    decide(state, lib, { option: "discard", target: p.items[0]! }, () => {});
    expect(state.pending?.kind).toBe("discardItem");
    expect((state.pending as { items: string[] }).items.every((u) => state.itemCards[u])).toBe(true);
  });
});
