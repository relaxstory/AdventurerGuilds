import { describe, expect, it } from "vitest";
import * as ab from "../src/abilities.js";
import { currentPlayer } from "../src/state.js";
import { hire, mission, realGame, run, take } from "./real.js";

describe("難度調整與骰數", () => {
  it("萊昂【風險評估】參與任何任務時難度調整 1", () => {
    const { state, lib } = realGame();
    const [leon] = hire(state, "STD-C21");
    const t = take(state, "STD-M04");
    expect(ab.difficulty(state, lib, mission(t, [leon!]), lib.task(state.taskCards[t]!.defKey))).toBe(1);
  });

  it("老約翰【熟門熟路】只在 [森林] 任務難度調整 2", () => {
    const { state, lib } = realGame();
    const [john] = hire(state, "STD-C23");
    const forest = take(state, "STD-M14");
    const city = take(state, "STD-M04");
    const d = (t: string) => ab.difficulty(state, lib, mission(t, [john!]), lib.task(state.taskCards[t]!.defKey));
    expect(d(forest)).toBe(2);
    expect(d(city)).toBe(0);
  });

  it("呂昶與凱蒂一起參與：兩人的【追捕默契】疊加為 2", () => {
    const { state, lib } = realGame();
    const [a, b] = hire(state, "STD-C25", "STD-C26");
    const t = take(state, "STD-M04");
    const def = lib.task(state.taskCards[t]!.defKey);
    expect(ab.difficulty(state, lib, mission(t, [a!]), def)).toBe(0);
    expect(ab.difficulty(state, lib, mission(t, [a!, b!]), def)).toBe(2);
  });

  it("嘗試指示物也計入難度調整", () => {
    const { state, lib } = realGame();
    const [leon] = hire(state, "STD-C21");
    const t = take(state, "STD-M04");
    state.taskCards[t]!.attempts = 2;
    expect(ab.difficulty(state, lib, mission(t, [leon!]), lib.task(state.taskCards[t]!.defKey))).toBe(3);
  });

  it("格芮絲與其他 [巫師] 一起參與時骰數 +1", () => {
    const { state, lib } = realGame();
    const [grace, reis, leon] = hire(state, "STD-C56", "STD-C57", "STD-C21");
    const t = take(state, "STD-M04");
    const def = lib.task(state.taskCards[t]!.defKey);
    expect(ab.dicePool(state, lib, mission(t, [grace!, leon!]), def)).toBe(1 + 1);
    expect(ab.dicePool(state, lib, mission(t, [grace!, reis!]), def)).toBe(1 + 3 + 1);
  });

  it("嗚嘎：[聰明] 任務基礎骰數 +3，結果值 −6", () => {
    const { state, lib } = realGame();
    const [uga] = hire(state, "STD-C35");
    const smart = take(state, "STD-M05");
    const other = take(state, "STD-M04");
    const def = (t: string) => lib.task(state.taskCards[t]!.defKey);
    expect(ab.dicePool(state, lib, mission(smart, [uga!]), def(smart))).toBe(3);
    expect(ab.resultModifier(state, lib, mission(smart, [uga!]), def(smart))).toBe(-6);
    expect(ab.dicePool(state, lib, mission(other, [uga!]), def(other))).toBe(0);
  });
});

describe("派遣與橫置", () => {
  it("暗影【充分準備】每輪第一次派遣不橫置，第二次要橫置", () => {
    const { state, lib } = realGame();
    const [shadow] = hire(state, "STD-C15");
    expect(ab.tapOnDispatch(state, lib, shadow!, () => {})).toBe(false);
    expect(ab.tapOnDispatch(state, lib, shadow!, () => {})).toBe(true);
    state.round += 1;
    expect(ab.tapOnDispatch(state, lib, shadow!, () => {})).toBe(false);
  });

  it("方庚【隨時警備】派遣時不需橫置；【今晚我請客】免除較低薪資 [士兵] 的薪資", () => {
    const { state, lib } = realGame();
    const [fang, charlie, leon] = hire(state, "STD-C38", "STD-C24", "STD-C21");
    expect(ab.tapOnDispatch(state, lib, fang!, () => {})).toBe(false);
    expect(ab.salaryFor(state, lib, [fang!, charlie!]).total).toBe(3); // 查理（士兵，薪資 1）免除
    expect(ab.salaryFor(state, lib, [fang!, leon!]).total).toBe(3 + 3); // 萊昂是參謀，不免除
  });

  it("方庚【隨時警備】：派遣後仍是直立，但每輪只能派遣 1 次；下一輪可以再派遣", () => {
    let { state, lib } = realGame();
    const [fang] = hire(state, "STD-C38");
    const t = take(state, "STD-M01");
    state.phase = "adventure";
    currentPlayer(state).gold = 50;
    state = run(state, lib, { type: "dispatch", task: t, adventurers: [fang!] }, { type: "roll" }, { type: "resolve" });
    expect(state.adventurerCards[fang!]!.tapped).toBe(false);
    expect(() => run(state, lib, { type: "dispatch", task: t, adventurers: [fang!] })).toThrow("每輪只能派遣 1 次");
    state.round += 1; // 下一輪
    expect(() => run(state, lib, { type: "dispatch", task: t, adventurers: [fang!] })).not.toThrow();
  });

  it("凱菲：參與一般任務時正常橫置、不放疲勞指示物", () => {
    const { state, lib } = realGame();
    const [kafi] = hire(state, "STD-C55");
    state.phase = "adventure";
    const out = run(state, lib, { type: "dispatch", task: take(state, "STD-M04"), adventurers: [kafi!] });
    expect(out.adventurerCards[kafi!]!.tapped).toBe(true);
    expect(out.adventurerCards[kafi!]!.tokens["疲勞"]).toBeUndefined();
  });

  it("凱菲：參與永久任務時不橫置而是放疲勞指示物，可以重複參與同一張永久任務；每個疲勞骰數 +1，達到 5 個翻面為過勞死凱菲", () => {
    let { state, lib } = realGame();
    const [kafi] = hire(state, "STD-C55");
    const t = take(state, "STD-M01");
    state.phase = "adventure";
    currentPlayer(state).gold = 100;
    for (let i = 1; i <= 4; i++) {
      state = run(state, lib, { type: "dispatch", task: t, adventurers: [kafi!] });
      expect(state.adventurerCards[kafi!]!.tapped).toBe(false);
      expect(state.adventurerCards[kafi!]!.tokens["疲勞"]).toBe(i);
      expect(state.mission!.dispatched).toEqual([kafi]);
      state = run(state, lib, { type: "roll" });
      expect(state.mission!.pool).toBe(1 + i);
      state = run(state, lib, { type: "resolve" });
    }
    state = run(state, lib, { type: "dispatch", task: t, adventurers: [kafi!] });
    const card = state.adventurerCards[kafi!]!;
    expect(card.face).toBe("back");
    expect(card.tapped).toBe(true);
    expect(card.tokens["疲勞"]).toBeUndefined();
    expect(ab.faceOf(state, lib, kafi!).name).toBe("「過勞死」凱菲");
  });

  it("過勞死凱菲：每回合第一個任務必須派遣他", () => {
    const { state, lib } = realGame();
    const [kafi, leon] = hire(state, "STD-C55B", "STD-C21");
    const t = take(state, "STD-M04");
    state.phase = "adventure";
    currentPlayer(state).gold = 20;
    expect(() => run(state, lib, { type: "dispatch", task: t, adventurers: [leon!] })).toThrow("必須派遣");
    expect(() => run(state, lib, { type: "dispatch", task: t, adventurers: [leon!, kafi!] })).not.toThrow();
  });

  it("馬克無法與 [狡詐] 冒險者一起參與任務", () => {
    const { state, lib } = realGame();
    const [mark, sid] = hire(state, "STD-C28", "STD-C09");
    const t = take(state, "STD-M04");
    state.phase = "adventure";
    expect(() => run(state, lib, { type: "dispatch", task: t, adventurers: [mark!, sid!] })).toThrow("無法與");
  });
});

describe("擲骰與結算", () => {
  it("莎莉：[聰明] 任務移除所有 6，每移除 1 顆獲得 1 金", () => {
    const { state, lib } = realGame();
    const [sally] = hire(state, "STD-C32");
    const t = take(state, "STD-M05");
    const m = mission(t, [sally!]);
    m.dice = [6, 3, 6];
    const def = lib.task(state.taskCards[t]!.defKey);
    ab.afterRollMandatory(state, lib, m, def, () => {});
    expect(m.dice).toEqual([3]);
    const p = currentPlayer(state);
    const gold = p.gold;
    ab.onSettle(state, lib, p, m, def, { success: false, faceSum: 3, slot: null, emptyBefore: new Set(), waivedBy: {} }, () => {});
    expect(p.gold).toBe(gold + 2);
  });

  it("阿絲特拉：骰面總和為偶數時聲望 +1（成功或失敗都會結算）", () => {
    const { state, lib } = realGame();
    const [astra] = hire(state, "STD-C33");
    const t = take(state, "STD-M04");
    const def = lib.task(state.taskCards[t]!.defKey);
    const p = currentPlayer(state);
    const rolled = { ...mission(t, [astra!]), dice: [4, 4] }; // 有擲骰（沒有擲骰時不觸發）
    ab.onSettle(state, lib, p, rolled, def, { success: false, faceSum: 8, slot: null, emptyBefore: new Set(), waivedBy: {} }, () => {});
    expect(p.reputation).toBe(1);
    ab.onSettle(state, lib, p, { ...rolled, dice: [3, 4] }, def, { success: false, faceSum: 7, slot: null, emptyBefore: new Set(), waivedBy: {} }, () => {});
    expect(p.reputation).toBe(1);
  });

  it("艾妲：不參與任務也會觸發，任務結算時若她是橫置狀態獲得 1 金", () => {
    const { state, lib } = realGame();
    const [ada, leon] = hire(state, "STD-C36", "STD-C21");
    const t = take(state, "STD-M04");
    const def = lib.task(state.taskCards[t]!.defKey);
    const p = currentPlayer(state);
    const gold = p.gold;
    ab.onSettle(state, lib, p, mission(t, [leon!]), def, { success: true, faceSum: 9, slot: null, emptyBefore: new Set(), waivedBy: {} }, () => {});
    expect(p.gold).toBe(gold);
    state.adventurerCards[ada!]!.tapped = true;
    ab.onSettle(state, lib, p, mission(t, [leon!]), def, { success: true, faceSum: 9, slot: null, emptyBefore: new Set(), waivedBy: {} }, () => {});
    expect(p.gold).toBe(gold + 1);
  });

  it("方壬：完成位於 [2] 的任務、而 [1] 沒有任務時，額外獲得 2 金", () => {
    const { state, lib } = realGame();
    const [fr, leon] = hire(state, "STD-C39", "STD-C21");
    const t = take(state, "STD-M04");
    const def = lib.task(state.taskCards[t]!.defKey);
    const p = currentPlayer(state);
    const gold = p.gold;
    ab.onSettle(state, lib, p, mission(t, [leon!]), def, { success: true, faceSum: 9, slot: 2, emptyBefore: new Set([1]), waivedBy: {} }, () => {});
    expect(p.gold).toBe(gold + 2);
    void fr;
  });
});

describe("招募、解僱與容量", () => {
  it("那個忠誠的勇者：被招募時獲得 3 聲望", () => {
    let { state, lib } = realGame();
    const uid = "hero";
    state.adventurerCards[uid] = { uid, defId: "STD-C11", face: "front", tapped: false, tokens: {} };
    state.tavern[0] = uid;
    state = run(state, lib, { type: "recruit", tavernIndex: 0 });
    expect(currentPlayer(state).reputation).toBe(3);
  });

  it("阿骨不計入冒險者容量", () => {
    const { state, lib } = realGame();
    hire(state, "STD-C58", "STD-C21", "STD-C22", "STD-C23", "STD-C24");
    expect(ab.capacityUsed(state, lib, currentPlayer(state))).toBe(4);
  });

  it("那個賴皮的勇者、過勞死凱菲不能被解僱", () => {
    let { state, lib } = realGame();
    const [lazy] = hire(state, "STD-C11B");
    expect(() => run(state, lib, { type: "recruit", tavernIndex: 0, replace: lazy! })).toThrow("無法被解僱");
  });

  it("青蛙合唱團【共鳴】：公會已有其他青蛙合唱團成員時，招募不消耗公會行動", () => {
    const { state, lib } = realGame();
    const [frog] = hire(state, "STD-C48");
    const p = currentPlayer(state);
    const uid = "z1";
    state.adventurerCards[uid] = { uid, defId: "STD-C49", face: "front", tapped: false, tokens: {} };
    expect(ab.freeRecruit(state, lib, p, uid)).toBe(true);
    p.adventurers = p.adventurers.filter((u) => u !== frog);
    expect(ab.freeRecruit(state, lib, p, uid)).toBe(false);
  });
});

describe("輪末與回合結束", () => {
  it("富豪巴克：不會於輪末重置，輪末若橫置獲得 2 金", () => {
    let { state, lib } = realGame();
    const [buck] = hire(state, "STD-C01");
    state.adventurerCards[buck!]!.tapped = true;
    const owner = currentPlayer(state).id;
    const gold = currentPlayer(state).gold;
    const pass = [{ type: "endGuildPhase" }, { type: "endAdventurePhase" }, { type: "endTurn" }] as const;
    state = run(state, lib, ...pass, ...pass, ...pass, ...pass);
    const p = state.players.find((x) => x.id === owner)!;
    expect(p.gold).toBe(gold + 2);
    expect(state.adventurerCards[buck!]!.tapped).toBe(true);
  });

  it("瑪絲珂：輪末若直立放置 1 個精工指示物", () => {
    let { state, lib } = realGame();
    const [mascot] = hire(state, "STD-C18");
    const pass = [{ type: "endGuildPhase" }, { type: "endAdventurePhase" }, { type: "endTurn" }] as const;
    state = run(state, lib, ...pass, ...pass, ...pass, ...pass);
    expect(state.adventurerCards[mascot!]!.tokens["精工"]).toBe(1);
  });

  it("過勞死凱菲：回合結束時若直立，橫置並支付 10 金；不足時扣到 0", () => {
    let { state, lib } = realGame();
    const [kafi] = hire(state, "STD-C55B");
    currentPlayer(state).gold = 4;
    const owner = currentPlayer(state).id;
    state = run(state, lib, { type: "endGuildPhase" }, { type: "endAdventurePhase" }, { type: "endTurn" });
    expect(state.players.find((x) => x.id === owner)!.gold).toBe(0);
    expect(state.adventurerCards[kafi!]!.tapped).toBe(true);
  });
});
