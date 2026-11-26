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

describe("奧【恢復術】（alpha1.4）", () => {
  const destroy = async () => (await import("../src/lifecycle.js")).destroyAdventurer;

  it("自己公會：丹妮絲要銷毀其他參與者時，奧可以使其無效，目標先橫置再重置（最後是直立）", () => {
    const state = game();
    const [denise, leon, o] = hire(state, "STD-C62", "STD-C21", "STD-C64");
    const t = take(state, "STD-M21");
    let s = run(state, lib, { type: "dispatch", task: t, adventurers: [denise!, leon!] });
    s = run(s, lib, { type: "decide", decision: { option: "destroy", target: leon! } });
    expect(s.pending).toMatchObject({ kind: "confirmRescue", rescuer: o, target: leon });
    s = run(s, lib, { type: "decide", decision: { option: "yes" } });
    expect(currentPlayer(s).adventurers).toContain(leon);
    expect(s.adventurerCards[o!]!.tapped).toBe(true);
    expect(s.adventurerCards[leon!]!.tapped).toBe(false);
  });

  it("其他公會：奧的擁有者使對手冒險者的銷毀無效，目標橫置，奧的擁有者提升 2 聲望", () => {
    const state = game();
    const [denise, leon] = hire(state, "STD-C62", "STD-C21");
    const other = state.players.find((p) => p.id !== currentPlayer(state).id)!;
    const o = `d${next++}`;
    state.adventurerCards[o] = { uid: o, defId: "STD-C64", face: "front", tapped: false, tokens: {} };
    other.adventurers.push(o);
    const rep = other.reputation;
    const t = take(state, "STD-M21");
    let s = run(state, lib, { type: "dispatch", task: t, adventurers: [denise!, leon!] });
    s = run(s, lib, { type: "decide", decision: { option: "destroy", target: leon! } });
    expect(s.pending).toMatchObject({ kind: "confirmRescue", player: other.id });
    s = run(s, lib, { type: "decide", decision: { option: "yes" } });
    expect(currentPlayer(s).adventurers).toContain(leon);
    expect(s.adventurerCards[leon!]!.tapped).toBe(true);
    expect(s.players.find((p) => p.id === other.id)!.reputation).toBe(rep + 2);
  });

  it("不使用時照常銷毀；代價與主動犧牲不能使用恢復術，負面效果可以；迪倫不會詢問", async () => {
    const destroyAdventurer = await destroy();
    const state = game();
    const [leon, o, dylan, fan] = hire(state, "STD-C21", "STD-C64", "STD-C63", "STD-C21");
    destroyAdventurer(state, lib, leon!, () => {}, true, "某張卡");
    expect(state.pending).toMatchObject({ kind: "confirmRescue", rescuer: o });
    const s = run(state, lib, { type: "decide", decision: { option: "no" } });
    expect(currentPlayer(s).adventurers).not.toContain(leon);
    destroyAdventurer(s, lib, fan!, () => {}, false, fan, true); // 代價或主動犧牲（G17）
    expect(s.pending).toBeNull();
    expect(currentPlayer(s).adventurers).not.toContain(fan);
    const [selfHarm] = hire(s, "STD-C21");
    destroyAdventurer(s, lib, selfHarm!, () => {}, false, selfHarm); // 負面效果：可以改為橫置
    expect(s.pending).toMatchObject({ kind: "confirmRescue", target: selfHarm });
    s.pending = null;
    // 衍生物不是恢復術的對象
    const beep = `d${next++}`;
    s.adventurerCards[beep] = { uid: beep, defId: "STD-T01", face: "front", tapped: false, tokens: {}, derivative: true };
    currentPlayer(s).adventurers.push(beep);
    destroyAdventurer(s, lib, beep, () => {}, true, "某張卡");
    expect(s.pending).toBeNull();
    expect(currentPlayer(s).adventurers).not.toContain(beep);
    destroyAdventurer(s, lib, dylan!, () => {}, true, "某張卡");
    expect(s.pending).toBeNull();
    expect(currentPlayer(s).adventurers).toContain(dylan);
  });

  it("瓦雷諾的替代先詢問：轉移給瓦雷諾後，再詢問奧要不要救瓦雷諾", async () => {
    const destroyAdventurer = await destroy();
    const state = game();
    const [leon, valeno] = hire(state, "STD-C21", "STD-C20");
    hire(state, "STD-C64");
    destroyAdventurer(state, lib, leon!, () => {}, true, "某張卡");
    expect(state.pending).toMatchObject({ kind: "confirmReplace", target: leon, replacement: valeno });
    const s = run(state, lib, { type: "decide", decision: { option: "yes" } });
    expect(s.pending).toMatchObject({ kind: "confirmRescue", target: valeno });
  });
});
