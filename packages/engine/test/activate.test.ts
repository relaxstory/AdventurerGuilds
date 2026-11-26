import { describe, expect, it } from "vitest";
import { currentPlayer, type GameState } from "../src/state.js";
import { hire, hireFor, otherSeat, realGame, run, take } from "./real.js";

function adventure(): ReturnType<typeof realGame> {
  const g = realGame();
  g.state.phase = "adventure";
  g.state.turnStartOpen = false;
  currentPlayer(g.state).gold = 20;
  return g;
}

const act = (card: string, skill: string, extra: object = {}) => ({ type: "activate" as const, card, skill, ...extra });

describe("主動能力：代價與效果", () => {
  it("艾里克【晨間禱告】：橫置後聲望 +1；已經橫置就無法再支付代價", () => {
    const { state, lib } = adventure();
    const [eric] = hire(state, "STD-C42");
    const out = run(state, lib, act(eric!, "【晨間禱告】"));
    expect(currentPlayer(out).reputation).toBe(1);
    expect(out.adventurerCards[eric!]!.tapped).toBe(true);
    expect(() => run(out, lib, act(eric!, "【晨間禱告】"))).toThrow("無法支付代價");
  });

  it("沒有寫時機的主動能力只能在冒險階段使用，公會階段不行", () => {
    const { state, lib } = adventure();
    const [eric] = hire(state, "STD-C42");
    const guild = structuredClone(state);
    guild.phase = "guild";
    expect(() => run(guild, lib, act(eric!, "【晨間禱告】"))).toThrow("只能在冒險階段使用");
    expect(() => run(state, lib, act(eric!, "【晨間禱告】"))).not.toThrow();
  });

  it("艾妲【今晚唱些老故事吧】：任務完成區每有 1 項任務，獲得 2 金", () => {
    const { state, lib } = adventure();
    const [ada] = hire(state, "STD-C36");
    currentPlayer(state).completed = ["a", "b", "c"];
    expect(currentPlayer(run(state, lib, act(ada!, "【今晚唱些老故事吧】"))).gold).toBe(20 + 6);
  });

  it("富豪巴克【時間就是金錢，朋友！】：支付 5 金重置一名冒險者，然後翻面為流浪漢巴克", () => {
    const { state, lib } = adventure();
    const [buck, leon] = hire(state, "STD-C01", "STD-C21");
    state.adventurerCards[leon!]!.tapped = true;
    const out = run(state, lib, act(buck!, "【時間就是金錢，朋友！】", { targets: [leon] }));
    expect(currentPlayer(out).gold).toBe(15);
    expect(out.adventurerCards[leon!]!.tapped).toBe(false);
    expect(out.adventurerCards[buck!]!.face).toBe("back");
  });

  it("「蛇眼」布萊克：橫置並支付 5 金，從任務棄置區取回任務到暫存格", () => {
    const { state, lib } = adventure();
    const [black] = hire(state, "STD-C02");
    const t = take(state, "STD-M04");
    currentPlayer(state).staging = [];
    state.taskDiscard.push(t);
    const out = run(state, lib, act(black!, "【嘶嘶嘶嘶～】", { task: t }));
    expect(currentPlayer(out).staging).toEqual([t]);
    expect(out.taskDiscard).not.toContain(t);
    expect(currentPlayer(out).gold).toBe(15);
  });

  it("巴爾【我敬你一杯！】：讓一名冒險者退役（移除指示物），再從酒館招募一名", () => {
    const { state, lib } = adventure();
    const [baal, kafi] = hire(state, "STD-C03", "STD-C55");
    state.adventurerCards[kafi!]!.tokens = { 疲勞: 2 };
    const recruit = state.tavern[1]!;
    const out = run(state, lib, act(baal!, "【我敬你一杯！】", { targets: [kafi], tavernIndex: 1 }));
    expect(currentPlayer(out).adventurers).toEqual([baal, recruit]);
    expect(out.adventurerDiscard).toContain(kafi);
    expect(out.adventurerCards[kafi!]!.tokens).toEqual({});
  });

  it("凱菲【我先睡一下……】：只能在回合開始時使用", () => {
    const { state, lib } = realGame();
    const [kafi] = hire(state, "STD-C55");
    state.adventurerCards[kafi!]!.tokens = { 疲勞: 3 };
    const out = run(state, lib, act(kafi!, "【我先睡一下……】"));
    expect(out.adventurerCards[kafi!]!.tokens).toEqual({});
    expect(out.adventurerCards[kafi!]!.tapped).toBe(true);
    const later = run(state, lib, { type: "acceptTask", boardIndex: 0 });
    expect(() => run(later, lib, act(kafi!, "【我先睡一下……】"))).toThrow("只能在回合開始時");
  });

  it("「爆炸頭」傑米【嘗試配方】：放上精工指示物時擲骰，出現 1 就全部移除", () => {
    const { state, lib } = adventure();
    const [jamie] = hire(state, "STD-C41");
    const out = run(state, lib, act(jamie!, "【嘗試配方】", { count: 3 }));
    const tokens = out.adventurerCards[jamie!]!.tokens["精工"];
    const rolled = out.log.find((l) => l.text.includes("擲出"))!.text;
    expect(rolled.includes("：移除所有") ? tokens === undefined : tokens === 3).toBe(true);
  });

  it("瑞斯教授【空間傳送】：在組隊步驟讓另一名直立冒險者加入任務，不付薪資、不橫置", () => {
    const { state, lib } = adventure();
    const [reis, leon, john] = hire(state, "STD-C57", "STD-C21", "STD-C23");
    const t = take(state, "STD-M04");
    let s = run(state, lib, { type: "dispatch", task: t, adventurers: [leon!] });
    const gold = currentPlayer(s).gold;
    s = run(s, lib, act(reis!, "【空間傳送】", { targets: [john] }));
    expect(s.mission!.joined).toEqual([john]);
    expect(s.adventurerCards[john!]!.tapped).toBe(false);
    expect(currentPlayer(s).gold).toBe(gold);
    s = run(s, lib, { type: "roll" });
    expect(s.mission!.pool).toBe(1 + 3);
    expect(() => run(state, lib, act(reis!, "【空間傳送】", { targets: [john] }))).toThrow("派遣後、建立骰池前");
  });
});

describe("指定與保護", () => {
  it("方葵【天羅地網】可以橫置對手的 [潛行] 冒險者，但不能指定暗影（不能被 [王國] 能力指定）", () => {
    const { state, lib } = adventure();
    const [fang] = hire(state, "STD-C16");
    const [shadow, kid] = hireFor(state, otherSeat(state), "STD-C15", "STD-C37");
    expect(() => run(state, lib, act(fang!, "【天羅地網】", { targets: [shadow] }))).toThrow("不能指定");
    const out = run(state, lib, act(fang!, "【天羅地網】", { targets: [kid] }));
    expect(out.adventurerCards[kid!]!.tapped).toBe(true);
  });

  it("威利：對手只能指定布魯斯與威利，所以方葵不能指定同一公會的怪盜雞德", () => {
    const { state, lib } = adventure();
    const [fang] = hire(state, "STD-C16");
    const [kid] = hireFor(state, otherSeat(state), "STD-C37", "STD-C12");
    expect(() => run(state, lib, act(fang!, "【天羅地網】", { targets: [kid] }))).toThrow("不能指定");
  });

  it("梭的和弦：湊齊汐與蕾時，其他玩家的能力無法指定這個公會的冒險者", () => {
    const { state, lib } = adventure();
    const [buck] = hire(state, "STD-C01");
    const seat = otherSeat(state);
    const [kid] = hireFor(state, seat, "STD-C37", "STD-C52", "STD-C54");
    state.adventurerCards[kid!]!.tapped = true;
    expect(() => run(state, lib, act(buck!, "【時間就是金錢，朋友！】", { targets: [kid] }))).not.toThrow();
    hireFor(state, seat, "STD-C49");
    expect(() => run(state, lib, act(buck!, "【時間就是金錢，朋友！】", { targets: [kid] }))).toThrow("不能指定");
  });

  it("菈的和弦：指定冒險者的數量 +1（巴克可以重置 2 名）", () => {
    const { state, lib } = adventure();
    const [buck, a, b] = hire(state, "STD-C01", "STD-C21", "STD-C22");
    for (const u of [a, b]) state.adventurerCards[u!]!.tapped = true;
    expect(() => run(state, lib, act(buck!, "【時間就是金錢，朋友！】", { targets: [a, b] }))).toThrow("1～1");
    hire(state, "STD-C53", "STD-C48", "STD-C50");
    const out = run(state, lib, act(buck!, "【時間就是金錢，朋友！】", { targets: [a, b] }));
    expect(out.adventurerCards[a!]!.tapped).toBe(false);
    expect(out.adventurerCards[b!]!.tapped).toBe(false);
  });
});

describe("跨玩家選擇", () => {
  it("布魯斯：對手選擇橫置一名直立冒險者或支付 3 金；決定前其他操作都會被擋下", () => {
    const { state, lib } = adventure();
    const [bruce] = hire(state, "STD-C12");
    const seat = otherSeat(state);
    const other = state.players[seat]!;
    other.gold = 10;
    const [leon] = hireFor(state, seat, "STD-C21");
    const s = run(state, lib, act(bruce!, "【布魯斯！】", { player: other.id }));
    expect(s.pending).toMatchObject({ kind: "tapOrPay", player: other.id, amount: 3 });
    expect(() => run(s, lib, { type: "endAdventurePhase" })).toThrow("做決定");
    const paid = run(s, lib, { type: "decide", decision: { option: "pay" } });
    expect(paid.players[seat]!.gold).toBe(7);
    expect(currentPlayer(paid).gold).toBe(20 - 2 + 3);
    const tapped = run(s, lib, { type: "decide", decision: { option: "tap", target: leon! } });
    expect(tapped.adventurerCards[leon!]!.tapped).toBe(true);
    expect(tapped.pending).toBeNull();
  });

  it("布魯斯：對手兩個選項都無法執行時，沒有效果", () => {
    const { state, lib } = adventure();
    const [bruce] = hire(state, "STD-C12");
    const seat = otherSeat(state);
    state.players[seat]!.gold = 0;
    const out = run(state, lib, act(bruce!, "【布魯斯！】", { player: state.players[seat]!.id }));
    expect(out.pending).toBeNull();
  });

  it("里諾：對手選擇翻面 → 狂人里諾觸發，擁有者從對手的直立冒險者中選一名橫置", () => {
    const { state, lib } = adventure();
    const owner = currentPlayer(state).id;
    const [rino] = hire(state, "STD-C17");
    const seat = otherSeat(state);
    const [leon] = hireFor(state, seat, "STD-C21");
    let s = run(state, lib, act(rino!, "【你好，我可以逮捕你嗎？】", { player: state.players[seat]!.id }));
    s = run(s, lib, { type: "decide", decision: { option: "flip" } });
    expect(s.adventurerCards[rino!]!.face).toBe("back");
    expect(s.pending).toMatchObject({ kind: "tapTarget", player: owner, targets: [leon] });
    s = run(s, lib, { type: "decide", decision: { option: "tap", target: leon! } });
    expect(s.adventurerCards[leon!]!.tapped).toBe(true);
  });
});

describe("翻面連鎖", () => {
  it("解僱忠誠的勇者 → 回到酒館翻面為賴皮的勇者 → 立即被額外招募回公會", () => {
    let { state, lib } = realGame();
    const [hero] = hire(state, "STD-C11");
    const recruit = state.tavern[0]!;
    state = run(state, lib, { type: "recruit", tavernIndex: 0, replace: hero! });
    const p = currentPlayer(state);
    expect(p.adventurers).toContain(recruit);
    expect(p.adventurers).toContain(hero);
    expect(state.adventurerCards[hero!]!.face).toBe("back");
    expect(state.tavern).not.toContain(hero);
    expect(() => run(state, lib, { type: "recruit", tavernIndex: 0, replace: hero! })).toThrow("無法被解僱");
  });
});

void ({} as GameState);
