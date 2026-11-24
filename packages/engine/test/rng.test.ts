import { describe, expect, it } from "vitest";
import { Rng } from "../src/rng.js";

describe("Rng", () => {
  it("同樣的種子產生同樣的結果", () => {
    expect(new Rng(42).rollDice(20)).toEqual(new Rng(42).rollDice(20));
  });

  it("不同的種子產生不同的結果", () => {
    expect(new Rng(1).rollDice(20)).not.toEqual(new Rng(2).rollDice(20));
  });

  it("存檔後還原可以接續同樣的數列", () => {
    const a = new Rng(7);
    a.rollDice(5);
    const saved = a.snapshot();
    const expected = a.rollDice(10);
    expect(Rng.restore(saved).rollDice(10)).toEqual(expected);
  });

  it("六面骰只會出現 1～6，且每一面都會出現", () => {
    const faces = new Rng(123).rollDice(6000);
    expect(Math.min(...faces)).toBe(1);
    expect(Math.max(...faces)).toBe(6);
    for (let f = 1; f <= 6; f++) {
      const count = faces.filter((x) => x === f).length;
      expect(count).toBeGreaterThan(850);
      expect(count).toBeLessThan(1150);
    }
  });

  it("洗牌不改動原陣列，且保留所有元素", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = new Rng(9).shuffle(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });

  it("抽樣數量不足時全部回傳", () => {
    expect(new Rng(1).sample([1, 2, 3], 80)).toHaveLength(3);
    expect(new Rng(1).sample([1, 2, 3, 4, 5], 2)).toHaveLength(2);
  });
});
