import { describe, expect, it } from "vitest";
import { adjustCondition, meetsCondition, turnOptions } from "../src/dice.js";

describe("轉動骰子", () => {
  it("2 可以轉成 1、3、4、6，不能轉成對面的 5", () => {
    expect(turnOptions(2)).toEqual([1, 3, 4, 6]);
  });

  it("每一面都有 4 個選項，且不含對面與自己", () => {
    for (let f = 1; f <= 6; f++) {
      const opts = turnOptions(f);
      expect(opts).toHaveLength(4);
      expect(opts).not.toContain(f);
      expect(opts).not.toContain(7 - f);
    }
  });
});

describe("難度調整", () => {
  it("≥X 變成 ≥X−n", () => {
    expect(adjustCondition({ op: "atLeast", x: 10 }, 2)).toEqual({ op: "atLeast", x: 8 });
  });

  it("≤X 變成 ≤X+n", () => {
    expect(adjustCondition({ op: "atMost", x: 6 }, 1)).toEqual({ op: "atMost", x: 7 });
  });

  it("X～Y 由玩家分配到兩端", () => {
    expect(adjustCondition({ op: "between", x: 8, y: 13 }, 3, 1)).toEqual({ op: "between", x: 7, y: 15 });
  });

  it("判定成功與失敗", () => {
    expect(meetsCondition({ op: "atLeast", x: 9 }, 9)).toBe(true);
    expect(meetsCondition({ op: "atLeast", x: 9 }, 8)).toBe(false);
    expect(meetsCondition({ op: "atMost", x: 6 }, 0)).toBe(true);
    expect(meetsCondition({ op: "between", x: 5, y: 9 }, 10)).toBe(false);
  });
});
