import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CardLibrary } from "../src/defs.js";
import { createGame } from "../src/setup.js";
import { currentPlayer, type GameState } from "../src/state.js";
import { config } from "./fixture.js";
import { run } from "./real.js";

// 使用目前的工作版本（data/cards.json），包含尚未發布的丹妮絲與迪倫
const built = JSON.parse(readFileSync(new URL("../../../data/cards.json", import.meta.url), "utf-8"));
const src = { ...built.cards, clauses: built.clauses.map((c: { cardId: string }) => ({ ...c, cardId: c.cardId === "（無編號）" ? "" : c.cardId })) };
const lib = new CardLibrary(src, true);
let next = 0;
function game() {
  const state = createGame(config({ includeTest: true }), src);
  state.phase = "adventure";
  state.turnStartOpen = false;
  currentPlayer(state).gold = 50;
  return state;
}
function hire(state: GameState, ...ids: string[]) {
  return ids.map((defId) => {
    const uid = `d${next++}`;
    state.adventurerCards[uid] = { uid, defId, face: "front", tapped: false, tokens: {} };
    currentPlayer(state).adventurers.push(uid);
    return uid;
  });
}
function take(state: GameState, id: string) {
  const uid = `t${next++}`;
  state.taskCards[uid] = { uid, defKey: [...lib.tasks.keys()].find((k) => k.startsWith(`${id}｜`))!, attempts: 0, completions: 0 };
  currentPlayer(state).staging.push(uid);
  return uid;
}

describe("丹妮絲與迪倫（alpha1.3 之後新增）", () => {
  it("丹妮絲參與時直接完成任務（不擲骰，無視任務目標）；單獨派遣時沒有其他參與者可以銷毀", () => {
    const state = game();
    const [denise] = hire(state, "STD-C62");
    const t = take(state, "STD-M49"); // 沉沒的古代門扉 ≥22
    const out = run(state, lib, { type: "dispatch", task: t, adventurers: [denise!] });
    expect(currentPlayer(out).completed).toContain(t);
    expect(out.log.some((l) => l.text.includes("直接完成"))).toBe(true);
    expect(out.log.some((l) => l.text.startsWith("擲 "))).toBe(false);
    expect(out.pending).toBeNull();
    expect(currentPlayer(out).adventurers).toContain(denise);
  });

  it("丹妮絲：結算後由擁有者銷毀一名其他參與者（不能選自己）", () => {
    const state = game();
    const [denise, leon] = hire(state, "STD-C62", "STD-C21");
    const t = take(state, "STD-M49");
    let s = run(state, lib, { type: "dispatch", task: t, adventurers: [denise!, leon!] });
    expect(s.pending).toMatchObject({ kind: "destroyOwn", source: denise, candidates: [leon] });
    s = run(s, lib, { type: "decide", decision: { option: "destroy", target: leon! } });
    expect(currentPlayer(s).adventurers).not.toContain(leon);
    expect(s.destroyed).toContain(leon);
  });

  it("迪倫：被銷毀時銷毀無效；丹妮絲選擇迪倫就不會失去冒險者", () => {
    const state = game();
    const [denise, dylan] = hire(state, "STD-C62", "STD-C63");
    const t = take(state, "STD-M49");
    let s = run(state, lib, { type: "dispatch", task: t, adventurers: [denise!, dylan!] });
    s = run(s, lib, { type: "decide", decision: { option: "destroy", target: dylan! } });
    expect(currentPlayer(s).adventurers).toEqual(expect.arrayContaining([denise, dylan]));
    expect(s.log.some((l) => l.text.includes("【不死之身】：銷毀無效"))).toBe(true);
  });

  it("沒有擲骰時，和骰子有關的效果不觸發（阿絲特拉的偶數聲望）", () => {
    const state = game();
    const [denise, astra] = hire(state, "STD-C62", "STD-C33");
    const t = take(state, "STD-M21");
    const rep = currentPlayer(state).reputation;
    let s = run(state, lib, { type: "dispatch", task: t, adventurers: [denise!, astra!] });
    s = run(s, lib, { type: "decide", decision: { option: "destroy", target: astra! } });
    expect(currentPlayer(s).reputation).toBe(rep); // 任務聲望 0，阿絲特拉沒有觸發
  });
});
