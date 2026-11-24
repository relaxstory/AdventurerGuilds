import { describe, expect, it } from "vitest";
import { RULES } from "../src/constants.js";
import { currentPlayer } from "../src/state.js";
import { adv, setup, source, task } from "./fixture.js";

describe("開局", () => {
  it("每位玩家 5 金、0 聲望、沒有冒險者，公告欄與酒館各 5 張", () => {
    const { state } = setup();
    for (const p of state.players) {
      expect(p).toMatchObject({ gold: 5, reputation: 0, adventurers: [], upgraded: false });
    }
    expect(state.board.filter(Boolean)).toHaveLength(5);
    expect(state.tavern).toHaveLength(5);
    expect(currentPlayer(state).actionsLeft).toBe(3);
  });

  it("同樣的種子得到同樣的開局", () => {
    expect(setup({ seed: 9 }).state).toEqual(setup({ seed: 9 }).state);
  });

  it("任務牌庫最多 50 張、冒險者牌庫最多 80 張，卡池不足時全部使用", () => {
    const many = source({
      adventurers: Array.from({ length: 100 }, (_, i) => adv(`C${i}`, 1, 1)),
      tasks: Array.from({ length: 70 }, (_, i) => task(`M${i}`, "一般", { op: "atLeast", x: 5 }, 4)),
    });
    const { state } = setup({}, many);
    expect(state.taskDeck.length + 5).toBe(RULES.taskDeckSize);
    expect(state.adventurerDeck.length + 5).toBe(RULES.adventurerDeckSize);
    const few = setup().state;
    expect(few.adventurerDeck.length + 5).toBe(20);
  });

  it("只使用實裝的卡片；測試模式另外加入「測試」的卡片", () => {
    const src = source({ adventurers: [adv("X1", 1, 1), adv("X2", 1, 1, { status: "測試" }), adv("X3", 1, 1, { status: "未實裝" })] });
    expect(Object.keys(setup({}, src).state.adventurerCards)).toHaveLength(1);
    expect(Object.keys(setup({ includeTest: true }, src).state.adventurerCards)).toHaveLength(2);
  });

  it("雙面卡的背面不會單獨進入牌庫", () => {
    const src = source({ adventurers: [adv("X1", 1, 1), adv("X1B", 3, 2, { backOf: "X1" })] });
    expect(Object.values(setup({}, src).state.adventurerCards).map((c) => c.defId)).toEqual(["X1"]);
  });

  it("史詩任務洗進牌庫下半部", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { state } = setup({ seed, includeEpic: true });
      const all = [...state.board, ...state.taskDeck].filter(Boolean) as string[];
      const pos = all.findIndex((uid) => state.taskCards[uid]!.defKey.startsWith("E1"));
      expect(pos).toBeGreaterThanOrEqual(Math.floor((all.length - 1) / 2));
    }
  });
});

describe("王國榮譽抽卡", () => {
  it("評選與競爭模式：人數 × 2 張", () => {
    expect(setup({ honorMode: "selection" }).state.honors).toHaveLength(8);
    expect(setup({ honorMode: "competition" }).state.honors).toHaveLength(8);
  });

  it("依路線平均：每條路線至少 1 張", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { state, lib } = setup({ seed, honorDraw: "balanced" });
      const routes = new Set(state.honors.map((id) => lib.honor(id).route));
      expect(routes).toEqual(new Set(["財富", "聲望", "任務", "人才"]));
    }
  });

  it("王國指派：每人 3 張，依路線平均時來自 3 條不同的路線，且不重複", () => {
    const { state, lib } = setup({ honorMode: "assignment", honorDraw: "balanced" });
    const all = state.players.flatMap((p) => p.assignedHonors);
    expect(new Set(all).size).toBe(12);
    for (const p of state.players) {
      expect(p.assignedHonors).toHaveLength(3);
      expect(new Set(p.assignedHonors.map((id) => lib.honor(id).route)).size).toBe(3);
    }
  });
});
