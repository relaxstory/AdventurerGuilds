import { describe, expect, it } from "vitest";
import { applyAction, CardLibrary, createGame, RuleError } from "../src/index.js";
import { simulate } from "../src/bot.js";
import type { HonorMode } from "../src/state.js";
import { config, source } from "./fixture.js";
import { realSource } from "./real.js";

const published = realSource;

describe("模擬整局", () => {
  it("同樣的種子得到同樣的結果", () => {
    const a = simulate(config({ seed: 5 }), source());
    const b = simulate(config({ seed: 5 }), source());
    expect(a).toEqual(b);
  });

  for (const honorMode of ["selection", "assignment", "competition"] as HonorMode[]) {
    it(`使用 alpha1.0 卡片資料跑完 8 輪（${honorMode}）`, () => {
      let abilityEvents = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const s = simulate(config({ seed, honorMode, includeEpic: false, includeTest: true }), published);
        expect(s.phase).toBe("gameOver");
        expect(s.round).toBe(8);
        expect(s.result!.winners.length).toBeGreaterThan(0);
        // 卡片能力確實有運作（例如派遣不橫置、指示物、重擲）
        abilityEvents += s.log.filter((l) => /不需橫置|指示物（共|重擲|轉成|移除|預言|：(金幣|聲望) [+-]/.test(l.text)).length;
        for (const p of s.players) {
          expect(p.gold).toBeGreaterThanOrEqual(0);
          expect(p.adventurers.length).toBeLessThanOrEqual(5);
          expect(p.distrust).toBeLessThanOrEqual(3);
        }
        // 卡片守恆：每張任務只會出現在一個地方
        const places = [
          ...s.taskDeck, ...s.board.filter(Boolean), ...s.taskDiscard,
          ...s.players.flatMap((p) => [...p.staging, ...p.formal.map((f) => f.uid), ...p.completed]),
        ];
        expect(new Set(places).size).toBe(places.length);
        expect(places.length).toBe(Object.keys(s.taskCards).length);
      }
      expect(abilityEvents).toBeGreaterThan(0);
    });
  }
});

describe("輪末補助", () => {
  it("金幣少於 3 的玩家在輪末補到 3 金，最後一輪不補", () => {
    let total = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const s = simulate(config({ seed, rounds: 2 }), published);
      const subsidies = s.log.filter((l) => l.text.startsWith("輪末補助"));
      expect(subsidies.every((l) => l.round === 1 && l.text.endsWith("→ 3"))).toBe(true);
      total += subsidies.length;
      const off = simulate(config({ seed, rounds: 2, goldFloor: 0 }), published);
      expect(off.log.some((l) => l.text.startsWith("輪末補助"))).toBe(false);
    }
    expect(total).toBeGreaterThan(0);
  });
});

describe("任務供應試驗方案", () => {
  it("牌庫頂（預設）：可以拿任務牌庫最上面的一張；只用公告欄的規則不行", () => {
    const s = simulate(config({ seed: 3, includeEpic: false, includeTest: true }), published);
    expect(s.log.some((l) => l.text.startsWith("接取任務"))).toBe(true);
    expect(s.phase).toBe("gameOver");
    const base = createGame(config({ seed: 3, taskSupply: "board" }), published);
    expect(() => applyAction(base, { type: "acceptTask", fromDeck: true }, new CardLibrary(published, false))).toThrow(RuleError);
  });
  it("回合開始補滿：每個玩家回合開始時公告欄沒有空位（牌庫還有牌時）", () => {
    let s = createGame(config({ seed: 4, taskSupply: "refill" }), published);
    const lib = new CardLibrary(published, false);
    s = applyAction(s, { type: "acceptTask", boardIndex: 0 }, lib);
    expect(s.board[0]).toBeNull();
    s = applyAction(s, { type: "endGuildPhase" }, lib);
    s = applyAction(s, { type: "endAdventurePhase" }, lib);
    while (s.phase === "cleanup") s = applyAction(s, { type: "endTurn" }, lib);
    if (s.taskDeck.length) expect(s.board.every(Boolean)).toBe(true);
  });
});
