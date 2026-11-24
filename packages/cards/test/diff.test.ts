import { describe, expect, it } from "vitest";
import { applyNumberChanges, diffCards } from "../src/diff.js";
import type { Clause } from "../src/mapping.js";
import type { Adventurer, CardData } from "../src/types.js";

const leon = (n: number, extra = ""): Adventurer => ({
  id: "STD-C21", name: "第六兵團副團長 萊昂", race: "人類", profession: "參謀", traits: ["[王國]"],
  skills: [{ name: "【風險評估】", text: `當此冒險者參與任務時，任務難度調整${n}。${extra}` }],
  baseDice: 1, salary: 3, flavor: "", englishName: "", story: "", status: "實裝",
});
const data = (...adventurers: Adventurer[]): CardData => ({ adventurers, derivatives: [], items: [], tasks: [], honors: [] });
const clause = (x: string): Clause => ({
  cardId: "STD-C21", cardName: "第六兵團副團長 萊昂", order: "1", skillName: "【風險評估】", clause: "1",
  code: "TASK_DIFFICULTY", x: "", y: x, z: "", note: "",
});

describe("差異比對", () => {
  it("找出新增、刪除與修改的欄位", () => {
    const before = data(leon(1));
    const after = data({ ...leon(1), salary: 4 });
    const diff = diffCards(before, after);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed[0]!.changes).toEqual([{ field: "薪資", before: "3", after: "4" }]);
  });

  it("沒有基準版本時全部算新增", () => {
    expect(diffCards(null, data(leon(1))).added).toHaveLength(1);
  });
});

describe("技能數值自動更新", () => {
  it("只改數字時，自動更新對應的子句參數", () => {
    const clauses = [clause("1")];
    const diff = diffCards(data(leon(1)), data(leon(2)));
    const updates = applyNumberChanges(diff, data(leon(2)), clauses);
    expect(updates[0]!.result).toBe("auto");
    expect(clauses[0]!.y).toBe("2");
  });

  it("重複執行時，辨識為已經是新數值", () => {
    const clauses = [clause("2")];
    const diff = diffCards(data(leon(1)), data(leon(2)));
    expect(applyNumberChanges(diff, data(leon(2)), clauses)[0]!.result).toBe("already");
  });

  it("文字句型改變時，交給人工確認，不自動修改", () => {
    const clauses = [clause("1")];
    const diff = diffCards(data(leon(1)), data(leon(1, "並獲得1金幣。")));
    const updates = applyNumberChanges(diff, data(leon(1, "並獲得1金幣。")), clauses);
    expect(updates[0]!.result).toBe("manual");
    expect(clauses[0]!.y).toBe("1");
  });
});
