import { describe, expect, it } from "vitest";
import { scoreGame } from "../src/honors.js";
import { setup } from "./fixture.js";

describe("王國榮譽計分", () => {
  it("最高者取得，同分都拿到；數值為 0 時不頒發", () => {
    const { state, lib } = setup();
    state.honors = ["H01", "H05"]; // 富甲一方、使命必達
    state.players[0]!.gold = 9;
    state.players[1]!.gold = 9;
    state.players[2]!.gold = 3;
    const r = scoreGame(state, lib);
    expect(r.honors[0]!.winners).toEqual(["A", "B"]);
    expect(r.honors[1]!.winners).toEqual([]); // 沒有人完成任務
    expect(r.winners).toEqual(["A", "B"]); // 總榮譽同分，共同勝利
  });

  it("暗影之主：聲望最低者，聲望必須小於 0", () => {
    const { state, lib } = setup();
    state.honors = ["H04"];
    expect(scoreGame(state, lib).honors[0]!.winners).toEqual([]);
    state.players[3]!.reputation = -2;
    expect(scoreGame(state, lib).honors[0]!.winners).toEqual(["D"]);
  });

  it("王國指派：持有者必須是第一名（含同分）才算達成，其他人拿不到", () => {
    const { state, lib } = setup({ honorMode: "assignment" });
    for (const p of state.players) p.assignedHonors = [];
    state.players[0]!.assignedHonors = ["H01"];
    state.players[0]!.gold = 4;
    state.players[1]!.gold = 8;
    let r = scoreGame(state, lib);
    expect(r.honors).toHaveLength(1);
    expect(r.honors[0]!.winners).toEqual([]);
    state.players[0]!.gold = 8;
    r = scoreGame(state, lib);
    expect(r.honors[0]!.winners).toEqual(["A"]);
    expect(r.totals).toEqual({ A: 1, B: 0, C: 0, D: 0 });
  });
});
