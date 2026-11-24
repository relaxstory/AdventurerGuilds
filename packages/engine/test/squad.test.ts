import { describe, expect, it } from "vitest";
import * as ab from "../src/abilities.js";
import { currentPlayer, type GameState } from "../src/state.js";
import { hire, mission, realGame, run, take } from "./real.js";

/** 把一名新兵放到酒館第一格。 */
function inTavern(state: GameState, defId: string, uid: string): void {
  state.adventurerCards[uid] = { uid, defId, face: "front", tapped: false, tokens: {} };
  state.tavern[0] = uid;
}

describe("新兵小隊", () => {
  it("招募新兵時可以放到現有小隊的最下方：不佔容量，隊長不變", () => {
    let { state, lib } = realGame();
    const [tom] = hire(state, "STD-C04");
    inTavern(state, "STD-C05", "fin");
    state = run(state, lib, { type: "recruit", tavernIndex: 0, squad: { target: tom!, position: "bottom" } });
    const p = currentPlayer(state);
    expect(p.adventurers).toEqual([tom]);
    expect(ab.members(state, tom!)).toEqual([tom, "fin"]);
    expect(ab.capacityUsed(state, lib, p)).toBe(1);
  });

  it("放到最上方時，新兵成為新的隊長", () => {
    let { state, lib } = realGame();
    const [tom] = hire(state, "STD-C04");
    inTavern(state, "STD-C08", "becky");
    state = run(state, lib, { type: "recruit", tavernIndex: 0, squad: { target: tom!, position: "top" } });
    expect(currentPlayer(state).adventurers).toEqual(["becky"]);
    expect(ab.members(state, "becky")).toEqual(["becky", tom]);
  });

  it("只有名字有「新兵」的冒險者能組成小隊", () => {
    const { state, lib } = realGame();
    const [leon] = hire(state, "STD-C21");
    inTavern(state, "STD-C05", "fin");
    expect(() => run(state, lib, { type: "recruit", tavernIndex: 0, squad: { target: leon!, position: "bottom" } })).toThrow("新兵");
  });

  it("骰數為全隊加總，薪資只付隊長；隊長湯姆每 2 名士兵骰數 +1", () => {
    const { state, lib } = realGame();
    const [tom] = hire(state, "STD-C04");
    state.adventurerCards[tom!]!.squad = ["s2", "s3", "s4"];
    for (const [u, d] of [["s2", "STD-C05"], ["s3", "STD-C06"], ["s4", "STD-C07"]] as const) {
      state.adventurerCards[u] = { uid: u, defId: d, face: "front", tapped: false, tokens: {} };
    }
    const t = take(state, "STD-M04");
    const def = lib.task(state.taskCards[t]!.defKey);
    expect(ab.unitBaseDice(state, lib, tom!)).toBe(4);
    expect(ab.dicePool(state, lib, mission(t, [tom!]), def)).toBe(4 + 2); // 4 名士兵 → +2
    expect(ab.salaryFor(state, lib, [tom!]).total).toBe(2);
  });

  it("隊長哈克貝里：每 2 名士兵薪資 −1，最低為 0", () => {
    const { state, lib } = realGame();
    const [huck] = hire(state, "STD-C06");
    state.adventurerCards[huck!]!.squad = ["s2", "s3", "s4", "s5"];
    for (const u of ["s2", "s3", "s4", "s5"]) state.adventurerCards[u] = { uid: u, defId: "STD-C05", face: "front", tapped: false, tokens: {} };
    expect(ab.salaryFor(state, lib, [huck!]).total).toBe(0); // 2 − 2，不會變負數
  });

  it("隊長哈伯：每 3 名士兵任務難度調整 1；不是隊長的成員能力無效", () => {
    const { state, lib } = realGame();
    const [harb] = hire(state, "STD-C10");
    state.adventurerCards[harb!]!.squad = ["s2", "s3"];
    state.adventurerCards["s2"] = { uid: "s2", defId: "STD-C04", face: "front", tapped: false, tokens: {} };
    state.adventurerCards["s3"] = { uid: "s3", defId: "STD-C04", face: "front", tapped: false, tokens: {} };
    const t = take(state, "STD-M04");
    const def = lib.task(state.taskCards[t]!.defKey);
    expect(ab.difficulty(state, lib, mission(t, [harb!]), def)).toBe(1);
    expect(ab.dicePool(state, lib, mission(t, [harb!]), def)).toBe(3); // 湯姆的骰數加成不生效
  });

  it("解僱小隊時，整支小隊回到酒館，佔 1 格", () => {
    let { state, lib } = realGame();
    const [tom] = hire(state, "STD-C04");
    state.adventurerCards[tom!]!.squad = ["s2"];
    state.adventurerCards["s2"] = { uid: "s2", defId: "STD-C05", face: "front", tapped: false, tokens: {} };
    state = run(state, lib, { type: "recruit", tavernIndex: 2, replace: tom! });
    expect(state.tavern[2]).toBe(tom);
    expect(ab.members(state, tom!)).toEqual([tom, "s2"]);
  });
});
