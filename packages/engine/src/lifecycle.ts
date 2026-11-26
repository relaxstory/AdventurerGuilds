/**
 * 衍生物的創造與銷毀、冒險者與道具的銷毀（含替代效果）、聲望下降的觸發、
 * 回合開始與任務結算後的效果（docs/spec.md 13、16.5）。
 */
import * as ab from "./abilities.js";
import type { CardLibrary } from "./defs.js";
import { removeItem } from "./items.js";
import type { GameState, Mission, PlayerState } from "./state.js";

type Log = (text: string) => void;

// ── 衍生物 ──

/** 創造衍生物到玩家的冒險者區（不佔容量）。 */
export function createDerivative(state: GameState, lib: CardLibrary, p: PlayerState, name: string, log: Log, tokens: Record<string, number> = {}): string | null {
  const id = lib.derivatives.get(name);
  if (!id) {
    log(`衍生物「${name}」不在本局卡池中`);
    return null;
  }
  const uid = `d${++state.derivativeSeq}`;
  state.adventurerCards[uid] = { uid, defId: id, face: "front", tapped: false, tokens: { ...tokens }, derivative: true };
  p.adventurers.push(uid);
  log(`創造 ${name}`);
  return uid;
}

/** 瑪絲珂【工作室】可以選擇的衍生物：具有指定特質（例如 [小嗶]）的衍生物。 */
export function workshopOptions(lib: CardLibrary, series: string): string[] {
  return [...lib.derivatives].filter(([, id]) => lib.adventurer(id).traits.some((t) => t.replace(/[\[\]]/g, "") === series)).map(([n]) => n);
}

// ── 銷毀 ──

/**
 * 銷毀冒險者（移出遊戲）。小隊整隊銷毀；衍生物回到衍生物牌組。
 * 瓦雷諾【你們走，我留下。】這類「你可以改為銷毀」的替代效果，會先詢問擁有者。
 */
/**
 * 銷毀冒險者。source 為造成銷毀的卡片（冒險者自身的效果時就是 uid 本身）。
 * 處理順序（docs/spec.md 13A.6）：迪倫的【不死之身】直接生效 → 瓦雷諾的替代 → 奧的【恢復術】 → 銷毀。
 */
export function destroyAdventurer(state: GameState, lib: CardLibrary, uid: string, log: Log, allowReplace = true, source?: string): void {
  const owner = ab.ownerOf(state, uid);
  const card = state.adventurerCards[uid];
  if (!owner || !card) return;
  // 迪倫【不死之身】：持續效果，直接生效，不會造成「將被銷毀」
  if (ab.has(state, lib, uid, "PREVENT_OWN_DESTRUCTION")) {
    log(`${ab.faceOf(state, lib, uid).name}【不死之身】：銷毀無效`);
    return;
  }
  if (allowReplace && !card.derivative) {
    const traits = ab.faceOf(state, lib, uid).traits.map((t) => t.replace(/[\[\]]/g, ""));
    const replacement = owner.adventurers.find(
      (u) => u !== uid && ab.clauses(state, lib, u, "REPLACE_DESTROY_ALLY").some((c) => traits.includes(c.x.replace(/[\[\]]/g, ""))),
    );
    if (replacement) {
      ab.pushPending(state, { kind: "confirmReplace", player: owner.id, what: "adventurer", target: uid, replacement, ...(source ? { source } : {}) });
      return;
    }
  }
  rescueOrDestroy(state, lib, uid, log, source);
}

/**
 * 奧【恢復術】：其他冒險者被「非該冒險者自身的效果」銷毀時，可以橫置奧使該次銷毀無效。
 * 依序詢問每一名直立的奧（declined 為已經不使用的）；都不使用就銷毀。
 */
export function rescueOrDestroy(state: GameState, lib: CardLibrary, uid: string, log: Log, source?: string, declined: readonly string[] = []): void {
  if (source !== uid) {
    for (const p of state.players) {
      const rescuer = p.adventurers.find(
        (u) => u !== uid && !declined.includes(u) && !state.adventurerCards[u]!.tapped && ab.has(state, lib, u, "REACT_PREVENT_DESTROY"),
      );
      if (rescuer) {
        ab.pushPending(state, { kind: "confirmRescue", player: p.id, rescuer, target: uid, ...(source ? { source } : {}), declined: [...declined] });
        return;
      }
    }
  }
  finalizeDestroy(state, lib, uid, log);
}

export function finalizeDestroy(state: GameState, lib: CardLibrary, uid: string, log: Log): void {
  const owner = ab.ownerOf(state, uid);
  const card = state.adventurerCards[uid];
  if (!owner || !card) return;
  const name = ab.faceOf(state, lib, uid).name;
  // 迪倫【不死之身】：使該次銷毀無效（可以替代的情況會先詢問是否使用替代效果，由玩家決定）
  if (ab.has(state, lib, uid, "PREVENT_OWN_DESTRUCTION")) {
    log(`${name}【不死之身】：銷毀無效`);
    return;
  }
  owner.adventurers = owner.adventurers.filter((u) => u !== uid);
  if (card.derivative) {
    delete state.adventurerCards[uid]; // 衍生物回到衍生物牌組
    log(`${name} 被銷毀，回到衍生物牌組`);
    return;
  }
  state.destroyed.push(...ab.members(state, uid));
  log(`${name} 被銷毀，移出遊戲`);
  // 艾里克【最後的禱言】：每當有非衍生物的冒險者被銷毀時
  for (const p of state.players) {
    for (const u of p.adventurers) {
      for (const c of ab.clauses(state, lib, u, "ON_DESTROY_GAIN")) ab.gain(p, ab.amount(state, lib, u, c.y), "聲望", log, ab.faceOf(state, lib, u).name);
    }
  }
}

/** 銷毀道具。【獨特】道具可以改為銷毀戈拉古斯的手稿（詢問持有者）。 */
export function destroyItem(state: GameState, lib: CardLibrary, p: PlayerState, uid: string, log: Log, allowReplace = true): void {
  const item = state.itemCards[uid];
  if (!item) return;
  const unique = lib.item(item.name).categories.some((c) => c.includes("獨特"));
  if (allowReplace && unique) {
    const manuscript = p.items.find(
      (u) => u !== uid && lib.clauses(lib.item(state.itemCards[u]!.name)).some((c) => c.code === "REPLACE_DESTROY_UNIQUE_ITEM"),
    );
    if (manuscript) {
      ab.pushPending(state, { kind: "confirmReplace", player: p.id, what: "item", target: uid, replacement: manuscript });
      return;
    }
  }
  removeItem(state, p, uid);
  log(`【${item.name}】被銷毀`);
}

// ── 聲望下降（梅里妲的注視）──

/** 比較操作前後的聲望，聲望下降（數值變小）的玩家觸發「聲望下降時」的道具。 */
export function checkReputationDrops(state: GameState, lib: CardLibrary, before: Record<string, number>, log: (player: string, text: string) => void): void {
  for (const p of state.players) {
    if (p.reputation >= (before[p.id] ?? p.reputation)) continue;
    for (const item of p.items) {
      const def = lib.item(state.itemCards[item]!.name);
      if (!lib.clauses(def).some((c) => c.code === "ON_REP_DECREASE_DESTROY")) continue;
      log(p.id, `聲望下降，觸發【${def.name}】`);
      if (p.adventurers.length) ab.pushPending(state, { kind: "destroyOwn", player: p.id, source: item, candidates: [...p.adventurers] });
      else destroyItem(state, lib, p, item, (t) => log(p.id, t));
    }
  }
}

// ── 回合開始 ──

export function onTurnStart(state: GameState, lib: CardLibrary, p: PlayerState, log: Log): void {
  for (const uid of [...p.adventurers]) {
    // 彌的和弦：創造彌的粉絲
    for (const c of ab.clauses(state, lib, uid, "TURNSTART_CREATE_TOKEN")) {
      for (let i = 0; i < ab.amount(state, lib, uid, c.x); i++) createDerivative(state, lib, p, c.y, log);
    }
    // 蕾的和弦：可以將一個任務的時限 +1
    for (const c of ab.clauses(state, lib, uid, "TURNSTART_TASK_TIME")) {
      const candidates = p.formal.filter((f) => f.timer !== null).map((f) => f.uid);
      if (candidates.length) {
        ab.pushPending(state, { kind: "extendTask", player: p.id, source: uid, amount: ab.amount(state, lib, uid, c.y), candidates });
      }
    }
  }
}

// ── 任務結算後 ──

export function afterSettle(state: GameState, lib: CardLibrary, p: PlayerState, m: Mission, success: boolean, log: Log): void {
  const party = ab.participants(m);
  const names = party.filter((u) => state.adventurerCards[u]).map((u) => ab.faceOf(state, lib, u).name.replace(/[\s「」]/g, ""));
  // 重置效果：汐的和弦（你完成任務後）、小丑小嗶（包含此冒險者的任務結算後）
  const resets: { source: string; count: number }[] = [];
  for (const uid of party) {
    for (const c of ab.clauses(state, lib, uid, "SETTLE_RESET")) if (c.x.includes("包含此冒險者")) resets.push({ source: uid, count: ab.amount(state, lib, uid, c.y) });
  }
  if (success) {
    for (const uid of p.adventurers) {
      for (const c of ab.clauses(state, lib, uid, "SETTLE_RESET")) if (c.x.includes("你完成任務")) resets.push({ source: uid, count: ab.amount(state, lib, uid, c.y) });
    }
  }
  for (const r of resets) {
    const candidates = p.adventurers.filter((u) => state.adventurerCards[u]!.tapped);
    if (r.count > 0 && candidates.length) ab.pushPending(state, { kind: "resetAdventurers", player: p.id, source: r.source, count: r.count, candidates });
  }
  // 丹妮絲【我很抱歉】：參與任務後（結算、領完獎勵之後），由擁有者銷毀一名其他參與的冒險者（小隊為整隊；衍生物也可以）
  for (const uid of party) {
    if (!state.adventurerCards[uid] || !ab.has(state, lib, uid, "AFTER_MISSION_DESTROY_PARTICIPANT")) continue;
    const owner = ab.ownerOf(state, uid);
    const candidates = party.filter((u) => u !== uid && state.adventurerCards[u] && owner?.adventurers.includes(u));
    const count = Math.min(candidates.length, ...ab.clauses(state, lib, uid, "AFTER_MISSION_DESTROY_PARTICIPANT").map((c) => ab.amount(state, lib, uid, c.x || "1")));
    for (let i = 0; owner && i < count; i++) ab.pushPending(state, { kind: "destroyOwn", player: owner.id, source: uid, candidates });
  }
  // 彌的粉絲【已滿足♡♡♡！】：和彌一同參與的任務結算後銷毀
  for (const uid of party) {
    if (!state.adventurerCards[uid]) continue;
    for (const c of ab.clauses(state, lib, uid, "WITH_CARD_DESTROY_AFTER")) {
      if (names.includes(c.x.replace(/[\s「」]/g, ""))) destroyAdventurer(state, lib, uid, log, false, uid); // 自身效果
    }
  }
}

// ── 輪末 ──

/** 輪末結算第 3 步：臨時衍生物（小嗶【臨時機體】）銷毀。 */
export function roundEndDestroy(state: GameState, lib: CardLibrary, log: (player: string, text: string) => void): void {
  for (const p of state.players) {
    for (const uid of [...p.adventurers]) {
      if (ab.has(state, lib, uid, "ROUNDEND_DESTROY_SELF")) destroyAdventurer(state, lib, uid, (t) => log(p.id, t), false, uid); // 自身效果
    }
  }
}
