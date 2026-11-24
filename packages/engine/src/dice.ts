/** 六面骰相鄰的面：轉動骰子時只能轉到相鄰的 4 個面，不能轉到對面（相對兩面和為 7）。 */
export function turnOptions(face: number): number[] {
  if (!Number.isInteger(face) || face < 1 || face > 6) throw new RangeError(`無效的骰面：${face}`);
  return [1, 2, 3, 4, 5, 6].filter((f) => f !== face && f !== 7 - face);
}

export type Condition =
  | { readonly op: "atLeast"; readonly x: number }
  | { readonly op: "atMost"; readonly x: number }
  | { readonly op: "between"; readonly x: number; readonly y: number };

/**
 * 套用難度調整 n（一律對玩家有利，見 docs/spec.md 7.2）。
 * 區間條件由玩家決定 n 如何分配到兩端：lowShift 為往下擴的量，其餘往上擴。
 */
export function adjustCondition(cond: Condition, n: number, lowShift = 0): Condition {
  if (n < 0) throw new RangeError("難度調整不能為負");
  switch (cond.op) {
    case "atLeast":
      return { op: "atLeast", x: cond.x - n };
    case "atMost":
      return { op: "atMost", x: cond.x + n };
    case "between": {
      if (lowShift < 0 || lowShift > n) throw new RangeError("區間分配超出難度調整量");
      return { op: "between", x: cond.x - lowShift, y: cond.y + (n - lowShift) };
    }
  }
}

export function meetsCondition(cond: Condition, result: number): boolean {
  switch (cond.op) {
    case "atLeast":
      return result >= cond.x;
    case "atMost":
      return result <= cond.x;
    case "between":
      return result >= cond.x && result <= cond.y;
  }
}
