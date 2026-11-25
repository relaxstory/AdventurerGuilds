import { describe, expect, it } from "vitest";
import { CardLibrary, type ClauseRow } from "../src/defs.js";
import { gainItem, usedItemSlots } from "../src/items.js";
import { createGame } from "../src/setup.js";
import { currentPlayer } from "../src/state.js";
import { config } from "./fixture.js";
import { hire, realSource, run, take } from "./real.js";

/** 用真實卡片資料建立遊戲，並替任務加上特殊規則或額外獎勵的子句。 */
function game(extra: Array<[cardId: string, cardName: string, code: string, x: string]> = []) {
  const clauses: ClauseRow[] = [
    ...realSource.clauses!,
    ...extra.map(([cardId, cardName, code, x]) => ({ cardId, cardName, order: "9", skillName: "特殊規則", clause: "1", code, x, y: "", z: "" })),
  ];
  const src = { ...realSource, clauses };
  const state = createGame(config({ includeTest: true }), src);
  state.phase = "adventure";
  state.turnStartOpen = false;
  currentPlayer(state).gold = 30;
  return { state, lib: new CardLibrary(src, true) };
}

describe("任務的特殊規則（alpha1.3）", () => {
  it("人數上限：派遣當下超過就不能派遣", () => {
    const { state, lib } = game([["STD-M04", "又壞掉的王都地磚", "TASK_MAX_PARTICIPANTS", "1"]]);
    const [a, b] = hire(state, "STD-C21", "STD-C13");
    const t = take(state, "STD-M04");
    expect(() => run(state, lib, { type: "dispatch", task: t, adventurers: [a!, b!] })).toThrow("最多派遣 1 名");
    expect(run(state, lib, { type: "dispatch", task: t, adventurers: [a!] }).mission).not.toBeNull();
  });

  it("人數下限：派遣當下不足就不能派遣", () => {
    const { state, lib } = game([["STD-M04", "又壞掉的王都地磚", "TASK_MIN_PARTICIPANTS", "2"]]);
    const [a, b] = hire(state, "STD-C21", "STD-C13");
    const t = take(state, "STD-M04");
    expect(() => run(state, lib, { type: "dispatch", task: t, adventurers: [a!] })).toThrow("至少需要派遣 2 名");
    expect(run(state, lib, { type: "dispatch", task: t, adventurers: [a!, b!] }).mission).not.toBeNull();
  });

  it("必須派遣具有特定特質的冒險者", () => {
    const { state, lib } = game([["STD-M04", "又壞掉的王都地磚", "TASK_REQUIRE_TRAIT", "[迅捷]"]]);
    const [leon, riley] = hire(state, "STD-C21", "STD-C13");
    const t = take(state, "STD-M04");
    expect(() => run(state, lib, { type: "dispatch", task: t, adventurers: [leon!] })).toThrow("必須派遣具有[迅捷]");
    expect(run(state, lib, { type: "dispatch", task: t, adventurers: [leon!, riley!] }).mission).not.toBeNull();
  });

  it("額外獎勵：完成任務時獲得道具", () => {
    const { state, lib } = game([["STD-M02", "送錯的軍令", "TASK_REWARD_ITEM", "小麥"]]);
    const [riley] = hire(state, "STD-C13");
    const t = take(state, "STD-M02");
    const out = run(state, lib, { type: "dispatch", task: t, adventurers: [riley!] }); // [迅捷] 直接完成
    expect(currentPlayer(out).items.map((u) => out.itemCards[u]!.name)).toEqual(["小麥"]);
  });
});

describe("相同道具堆疊（alpha1.3）", () => {
  it("相同名稱的道具只佔 1 格；超過上限時捨棄到不超過為止", () => {
    const { state, lib } = game();
    const p = currentPlayer(state);
    for (const n of ["小麥", "小麥", "小麥", "牛乳"]) gainItem(state, lib, p, n, () => {});
    expect(usedItemSlots(state, lib, p)).toBe(2);
    expect(state.pending).toBeNull();
    gainItem(state, lib, p, "獸皮", () => {});
    expect(state.pending?.kind).toBe("discardItem");
    const wheat = p.items.find((u) => state.itemCards[u]!.name === "小麥")!;
    let s = run(state, lib, { type: "decide", decision: { option: "discard", target: wheat } });
    expect(s.pending?.kind).toBe("discardItem"); // 捨棄一個小麥仍然佔 3 格
    const hide = currentPlayer(s).items.find((u) => s.itemCards[u]!.name === "獸皮")!;
    s = run(s, lib, { type: "decide", decision: { option: "discard", target: hide } });
    expect(s.pending).toBeNull();
    expect(usedItemSlots(s, lib, currentPlayer(s))).toBe(2);
  });
});

describe("賴皮的勇者依招募規則（alpha1.3）", () => {
  function fullGuildWithLoyalHero(fireable: boolean) {
    const { state, lib } = game();
    state.phase = "guild";
    const fillers = fireable ? ["STD-C21", "STD-C13", "STD-C04", "STD-C11B"] : ["STD-C11B", "STD-C11B", "STD-C11B", "STD-C11B"];
    const [hero] = hire(state, "STD-C11");
    hire(state, ...fillers);
    // 酒館第一張換成一名不能被解僱的冒險者，招募他並解僱忠誠的勇者
    state.adventurerCards["incoming"] = { uid: "incoming", defId: "STD-C11", face: "back", tapped: false, tokens: {} };
    state.tavern[0] = "incoming";
    return { state, lib, hero: hero! };
  }

  it("冒險者已滿：必須解僱一名，被解僱者回到酒館勇者原本的位置", () => {
    const { state, lib, hero } = fullGuildWithLoyalHero(true);
    let s = run(state, lib, { type: "recruit", tavernIndex: 0, replace: hero });
    expect(s.pending).toMatchObject({ kind: "fireForRecruit", recruit: hero });
    const target = (s.pending as { candidates: string[] }).candidates[0]!;
    const at = s.tavern.indexOf(hero);
    s = run(s, lib, { type: "decide", decision: { option: "fire", target } });
    const p = currentPlayer(s);
    expect(p.adventurers).toContain(hero);
    expect(p.adventurers).not.toContain(target);
    expect(s.tavern[at]).toBe(target);
    expect(p.adventurers.length).toBe(5);
  });

  it("沒有可以解僱的冒險者：賴皮的勇者進入冒險者棄置區", () => {
    const { state, lib, hero } = fullGuildWithLoyalHero(false);
    const s = run(state, lib, { type: "recruit", tavernIndex: 0, replace: hero });
    expect(s.pending).toBeNull();
    expect(s.adventurerDiscard).toContain(hero);
    expect(currentPlayer(s).adventurers).not.toContain(hero);
  });
});

describe("永久任務：每名冒險者每回合只能參與同一張一次（alpha1.3）", () => {
  it("參與過的冒險者被重置後，不能再參與同一張永久任務（不論成功或失敗），但可以去做其他任務；沒參與過的可以", () => {
    let { state, lib } = game();
    const [a, b, c] = hire(state, "STD-C21", "STD-C13", "STD-C04");
    const slime = take(state, "STD-M01"); // 清除史萊姆（永久）
    const other = take(state, "STD-M04");
    state = run(state, lib, { type: "dispatch", task: slime, adventurers: [a!, b!] }, { type: "roll" }, { type: "resolve" });
    state.adventurerCards[a!]!.tapped = false; // 例如被汐重置
    expect(() => run(state, lib, { type: "dispatch", task: slime, adventurers: [a!] })).toThrow("同一回合不能再參與同一張永久任務");
    expect(() => run(state, lib, { type: "dispatch", task: slime, adventurers: [a!, c!] })).toThrow("同一回合不能再參與同一張永久任務");
    expect(run(state, lib, { type: "dispatch", task: slime, adventurers: [c!] }).mission).not.toBeNull();
    expect(run(state, lib, { type: "dispatch", task: other, adventurers: [a!] }).mission).not.toBeNull();
  });

  it("用「加入此次任務」加入的冒險者也算參與", () => {
    let { state, lib } = game();
    const [a, c, rhys] = hire(state, "STD-C21", "STD-C13", "STD-C57");
    const slime = take(state, "STD-M01");
    state = run(state, lib, { type: "dispatch", task: slime, adventurers: [a!] }, { type: "roll" }, { type: "resolve" });
    state.adventurerCards[a!]!.tapped = false;
    const s = run(state, lib, { type: "dispatch", task: slime, adventurers: [c!] });
    expect(() => run(s, lib, { type: "activate", card: rhys!, skill: "【空間傳送】", targets: [a!] })).toThrow("同一回合不能再參與同一張永久任務");
  });
});
