import { describe, expect, it } from "vitest";
import { createDerivative } from "../src/lifecycle.js";
import { currentPlayer } from "../src/state.js";
import { hire, hireFor, otherSeat, realGame, run, take } from "./real.js";

const pass = [{ type: "endGuildPhase" }, { type: "endAdventurePhase" }, { type: "endTurn" }] as const;

function adventure(): ReturnType<typeof realGame> {
  const g = realGame();
  g.state.phase = "adventure";
  g.state.turnStartOpen = false;
  currentPlayer(g.state).gold = 20;
  return g;
}

describe("特殊能力", () => {
  it("暴走小嗶：和瑪絲珂在同一個公會時，洗回冒險者牌庫", () => {
    let { state, lib } = realGame();
    hire(state, "STD-C18");
    state.adventurerCards["run"] = { uid: "run", defId: "STD-C19", face: "front", tapped: false, tokens: {} };
    state.tavern[0] = "run";
    const deck = state.adventurerDeck.length;
    state = run(state, lib, { type: "recruit", tavernIndex: 0 });
    expect(currentPlayer(state).adventurers).not.toContain("run");
    expect(state.adventurerDeck).toContain("run");
    expect(state.adventurerDeck.length).toBe(deck); // 補了一張到酒館，又洗回一張
  });

  it("送錯的軍令：派遣 [迅捷] 冒險者參與時，直接完成任務（不擲骰）", () => {
    const { state, lib } = adventure();
    const [riley, leon] = hire(state, "STD-C13", "STD-C21");
    const t = take(state, "STD-M02");
    const s = run(state, lib, { type: "dispatch", task: t, adventurers: [riley!] });
    expect(s.mission).toBeNull();
    expect(currentPlayer(s).completed).toEqual([t]);
    expect(s.log.some((l) => l.text.includes("直接完成"))).toBe(true);
    // 沒有 [迅捷] 冒險者時照常擲骰
    const t2 = take(state, "STD-M02");
    expect(run(state, lib, { type: "dispatch", task: t2, adventurers: [leon!] }).mission).not.toBeNull();
  });

  it("守門員小嗶：對手橫置你的冒險者時改為指定它，原本的目標不受影響，守門員被銷毀", () => {
    const { state, lib } = adventure();
    const [fang] = hire(state, "STD-C16");
    const seat = otherSeat(state);
    const [kid] = hireFor(state, seat, "STD-C37");
    const guard = createDerivative(state, lib, state.players[seat]!, "守門員小嗶", () => {}, { 精工: 2 })!;
    const out = run(state, lib, { type: "activate", card: fang!, skill: "【天羅地網】", targets: [kid] });
    expect(out.adventurerCards[kid!]!.tapped).toBe(false);
    expect(out.adventurerCards[guard]).toBeUndefined();
  });

  it("菲特：暫時翻轉里諾成狂人里諾（觸發翻面效果），輪末翻回；能力結束前不能再翻面", () => {
    let { state, lib } = adventure();
    const owner = currentPlayer(state).id;
    const [fate, rino, leon] = hire(state, "STD-C40", "STD-C17", "STD-C21");
    state = run(state, lib, { type: "activate", card: fate!, skill: "【如果當時……】", targets: [rino] });
    expect(state.adventurerCards[rino!]!.face).toBe("back");
    // 使其翻面的玩家是自己，所以狂人里諾要橫置自己公會中的一名直立冒險者
    expect(state.pending).toMatchObject({ kind: "tapTarget", player: owner });
    state = run(state, lib, { type: "decide", decision: { option: "tap", target: leon! } });
    expect(() => run(state, lib, { type: "activate", card: rino!, skill: "【你好，我可以逮捕你嗎？】", player: state.players[otherSeat(state)]!.id })).toThrow();
    state = run(state, lib, { type: "endAdventurePhase" }, { type: "endTurn" }, ...pass, ...pass, ...pass);
    // 輪末翻回里諾（狂人→里諾不會觸發效果）
    expect(state.round).toBe(2);
    expect(state.adventurerCards[rino!]!.face).toBe("front");
    expect(state.adventurerCards[rino!]!.flipLock).toBeUndefined();
    void owner;
  });

  it("學舌鳥：複製艾里克【晨間禱告】的效果，聲望共 +2", () => {
    const { state, lib } = adventure();
    const [eric, bird] = hire(state, "STD-C42", "STD-C47");
    const out = run(state, lib, { type: "activate", card: eric!, skill: "【晨間禱告】", copy: { card: bird! } });
    expect(currentPlayer(out).reputation).toBe(2);
    expect(out.adventurerCards[bird!]!.tapped).toBe(true);
  });

  it("學舌鳥：只能複製目前可以完整執行的效果（不能複製巴克的「將此冒險者翻面」）", () => {
    const { state, lib } = adventure();
    const [buck, bird, leon] = hire(state, "STD-C01", "STD-C47", "STD-C21");
    state.adventurerCards[leon!]!.tapped = true;
    expect(() =>
      run(state, lib, { type: "activate", card: buck!, skill: "【時間就是金錢，朋友！】", targets: [leon], copy: { card: bird!, params: { targets: [leon!] } } }),
    ).toThrow("無法完整執行");
  });

  it("學舌鳥：複製方葵的能力時可以指定不同的目標", () => {
    const { state, lib } = adventure();
    const [fang, bird] = hire(state, "STD-C16", "STD-C47");
    const [kid, shadowless] = hireFor(state, otherSeat(state), "STD-C37", "STD-C46");
    const out = run(state, lib, { type: "activate", card: fang!, skill: "【天羅地網】", targets: [kid], copy: { card: bird!, params: { targets: [shadowless!] } } });
    expect(out.adventurerCards[kid!]!.tapped).toBe(true);
    expect(out.adventurerCards[shadowless!]!.tapped).toBe(true);
  });
});
void take;
