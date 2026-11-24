import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { simulate } from "../src/bot.js";
import type { CardSource } from "../src/defs.js";
import type { HonorMode } from "../src/state.js";
import { config, source } from "./fixture.js";

const published = JSON.parse(readFileSync(new URL("../../../data/versions/v1.json", import.meta.url), "utf-8")).cards as CardSource;

describe("模擬整局", () => {
  it("同樣的種子得到同樣的結果", () => {
    const a = simulate(config({ seed: 5 }), source());
    const b = simulate(config({ seed: 5 }), source());
    expect(a).toEqual(b);
  });

  for (const honorMode of ["selection", "assignment", "competition"] as HonorMode[]) {
    it(`使用 alpha1.0 卡片資料跑完 8 輪（${honorMode}）`, () => {
      for (let seed = 1; seed <= 10; seed++) {
        const s = simulate(config({ seed, honorMode, includeEpic: false, includeTest: true }), published);
        expect(s.phase).toBe("gameOver");
        expect(s.round).toBe(8);
        expect(s.result!.winners.length).toBeGreaterThan(0);
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
    });
  }
});
