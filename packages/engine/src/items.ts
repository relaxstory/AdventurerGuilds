/**
 * 道具（docs/spec.md 13A.1、16.3）：取得、道具區上限、使用、出售。
 */
import * as ab from "./abilities.js";
import { RULES } from "./constants.js";
import type { CardLibrary, ItemDef } from "./defs.js";
import { RuleError } from "./errors.js";
import type { Rng } from "./rng.js";
import type { GameState, PlayerState } from "./state.js";

type Log = (text: string) => void;

const bare = (s: string) => s.replace(/^[\[［](.*)[\]］]$/, "$1");
export const splitList = (v: string) => v.split("／").map((x) => x.trim()).filter(Boolean);

export function itemDef(state: GameState, lib: CardLibrary, uid: string): ItemDef {
  const card = state.itemCards[uid];
  if (!card) throw new Error(`找不到道具 ${uid}`);
  return lib.item(card.name);
}

export function itemClauses(state: GameState, lib: CardLibrary, uid: string) {
  return lib.clauses(itemDef(state, lib, uid));
}

const isStatus = (d: ItemDef) => d.categories.some((c) => bare(c) === "狀態");
const isUnique = (d: ItemDef) => d.categories.some((c) => bare(c) === "獨特");

/** 道具區的格數：基本 3 格，加上能力（法的和弦）。 */
export function itemSlots(state: GameState, lib: CardLibrary, p: PlayerState): number {
  let n = RULES.itemSlots;
  for (const u of p.adventurers) for (const c of ab.clauses(state, lib, u, "EXTRA_ITEM_SLOT")) n += ab.amount(state, lib, u, c.x);
  return n;
}

/** 佔用道具格的道具（[狀態] 道具不佔格）。 */
export function slottedItems(state: GameState, lib: CardLibrary, p: PlayerState): string[] {
  return p.items.filter((u) => !isStatus(itemDef(state, lib, u)));
}

const newUid = (state: GameState) => `i${++state.itemSeq}`;

/**
 * 獲得道具。【獨特】道具整場只有一份；道具區超過上限時，玩家必須捨棄一個（可以是新的這個）。
 */
export function gainItem(state: GameState, lib: CardLibrary, p: PlayerState, name: string, log: Log, tokens: Record<string, number> = {}): string | null {
  if (!lib.items.has(name)) {
    log(`道具「${name}」不在本局卡池中`);
    return null;
  }
  const def = lib.item(name);
  if (isUnique(def)) {
    if (state.uniquesCreated.includes(name)) {
      log(`【${name}】是獨特道具，已經出現過，拿不到`);
      return null;
    }
    state.uniquesCreated.push(name);
  }
  const uid = newUid(state);
  state.itemCards[uid] = { uid, name, tokens };
  p.items.push(uid);
  log(`獲得【${name}】`);
  const slotted = slottedItems(state, lib, p);
  if (slotted.length > itemSlots(state, lib, p)) {
    ab.pushPending(state, { kind: "discardItem", player: p.id, items: slotted });
  }
  return uid;
}

export function removeItem(state: GameState, p: PlayerState, uid: string): void {
  p.items = p.items.filter((u) => u !== uid);
  delete state.itemCards[uid];
}

/** 道具是否屬於某個分類；可以代替其他道具消耗的道具（漢克的貨品）也算。 */
export function itemMatches(state: GameState, lib: CardLibrary, uid: string, category: string): boolean {
  const def = itemDef(state, lib, uid);
  if (def.categories.some((c) => bare(c) === bare(category))) return true;
  return itemClauses(state, lib, uid).some((c) => c.code === "SUBSTITUTE_ITEM" && splitList(c.x).some((x) => bare(x) === bare(category)));
}

/** 消耗 n 個某分類的道具，優先使用本身就屬於該分類的道具。 */
export function consumeCategory(state: GameState, lib: CardLibrary, p: PlayerState, n: number, category: string, log: Log): void {
  const exact = p.items.filter((u) => itemDef(state, lib, u).categories.some((c) => bare(c) === bare(category)));
  const subs = p.items.filter((u) => !exact.includes(u) && itemMatches(state, lib, u, category));
  const pick = [...exact, ...subs].slice(0, n);
  if (pick.length < n) throw new RuleError(`需要 ${n} 個 ${category}，目前只有 ${pick.length} 個`);
  log(`消耗 ${pick.map((u) => `【${state.itemCards[u]!.name}】`).join("、")}`);
  for (const u of pick) removeItem(state, p, u);
}

export function countCategory(state: GameState, lib: CardLibrary, p: PlayerState, category: string): number {
  return p.items.filter((u) => itemMatches(state, lib, u, category)).length;
}

/** 出售價格：售價加上能力修正（漢克【農莊加工】）。 */
export function sellPrice(state: GameState, lib: CardLibrary, p: PlayerState, uid: string): number {
  const def = itemDef(state, lib, uid);
  let price = def.price ?? 0;
  for (const u of p.adventurers) {
    for (const c of ab.clauses(state, lib, u, "SELL_PRICE_MOD")) {
      if (splitList(c.x).some((x) => def.categories.some((d) => bare(d) === bare(x)))) price += ab.amount(state, lib, u, c.y);
    }
  }
  return price;
}

/** 公會整理階段出售道具（[狀態] 道具不能出售）。 */
export function sellItem(state: GameState, lib: CardLibrary, p: PlayerState, uid: string, log: Log): void {
  if (!p.items.includes(uid)) throw new RuleError("只能出售自己的道具");
  const def = itemDef(state, lib, uid);
  if (isStatus(def)) throw new RuleError(`【${def.name}】是狀態，不能出售`);
  const price = sellPrice(state, lib, p, uid);
  removeItem(state, p, uid);
  p.gold += price;
  log(`出售【${def.name}】，獲得 ${price} 金`);
}

/** 道具區超過上限時捨棄（[狀態] 道具不能捨棄）。 */
export function discardItem(state: GameState, lib: CardLibrary, p: PlayerState, uid: string, log: Log): void {
  const def = itemDef(state, lib, uid);
  if (!p.items.includes(uid) || isStatus(def)) throw new RuleError("請選擇道具區中的道具");
  removeItem(state, p, uid);
  log(`捨棄【${def.name}】`);
}

export interface UseItemParams {
  readonly item: string;
  readonly targets?: readonly string[];
}

/**
 * 使用道具：「消耗此道具：……」以及「消耗所有同名道具」（火爪的信念）。
 * 影響骰數的道具只能在派遣的組隊步驟使用；希氏炸藥在擲骰後的調整步驟使用。
 */
export function useItem(state: GameState, lib: CardLibrary, p: PlayerState, a: UseItemParams, log: Log, rng?: Rng): void {
  if (!p.items.includes(a.item)) throw new RuleError("只能使用自己的道具");
  if (state.phase !== "guild" && state.phase !== "adventure") throw new RuleError("道具只能在公會階段或冒險階段使用");
  const def = itemDef(state, lib, a.item);
  const clauses = itemClauses(state, lib, a.item);
  const label = `【${def.name}】`;
  const codes = clauses.map((c) => c.code);

  if (codes.includes("CONSUME_ALL_TIER_GAIN")) {
    if (state.mission) throw new RuleError("派遣進行中，不能使用這個道具");
    const all = p.items.filter((u) => state.itemCards[u]!.name === def.name);
    for (const u of all) removeItem(state, p, u);
    const n = all.length;
    // 火爪的信念：1 個聲望+1；2 個聲望+2、金幣+1；3 個以上聲望+4、金幣+2
    const [rep, gold] = n >= 3 ? [4, 2] : n === 2 ? [2, 1] : [1, 0];
    log(`消耗 ${n} 個${label}`);
    ab.gain(p, rep, "聲望", log, label);
    ab.gain(p, gold, "金幣", log, label);
    return;
  }
  if (!codes.includes("ITEM_CONSUME")) throw new RuleError(`${label} 不是可以使用的道具`);

  const affectsDice = codes.includes("EFF_BASE_DICE_ROUND");
  const tier = codes.includes("ITEM_TOKEN_TIER_RESULT");
  // 派遣 → 建立骰池 → 擲骰 → 結果是連續的動作，影響骰數的道具只能在派遣流程以外的冒險階段使用
  if (affectsDice && (state.phase !== "adventure" || state.mission)) throw new RuleError(`${label} 只能在冒險階段、派遣流程以外的時候使用`);
  if (tier && state.mission?.stage !== "adjust") throw new RuleError(`${label} 只能在擲骰後使用`);
  if (!affectsDice && !tier && state.mission) throw new RuleError("派遣進行中，不能使用這個道具");

  const needsTarget = codes.some((c) => c === "EFF_BASE_DICE_ROUND" || c === "EFF_RESET");
  const target = a.targets?.[0];
  if (needsTarget) {
    if (!target || a.targets!.length !== 1) throw new RuleError(`${label}：請選擇一名冒險者`);
    if (!canTargetByItem(state, lib, p, target)) throw new RuleError(`${label}：不能指定 ${ab.faceOf(state, lib, target).name}`);
  }

  const itemTokens = { ...state.itemCards[a.item]!.tokens };
  removeItem(state, p, a.item);
  log(`使用${label}`);
  // 對其他玩家的冒險者使用不利的道具（縮小藥劑、紅斑菌菇）：守門員小嗶可以擋下
  const harmful = clauses.some((c) => (c.code === "EFF_BASE_DICE_ROUND" && Number(c.x) < 0) || c.code === "EFF_NO_RESET_ROUND");
  if (target && harmful && rng && !ab.passesGuard(state, lib, rng, p.id, target, log)) return;
  for (const c of clauses) {
    const card = target ? state.adventurerCards[target]! : undefined;
    const name = target ? ab.faceOf(state, lib, target).name : "";
    switch (c.code) {
      case "EFF_BASE_DICE_ROUND": {
        const delta = Number(c.x);
        const prev = card!.roundBaseDelta?.round === state.round ? card!.roundBaseDelta.delta : 0;
        card!.roundBaseDelta = { round: state.round, delta: prev + delta };
        log(`${name} 本輪基礎骰數 ${delta > 0 ? "+" : ""}${delta}`);
        break;
      }
      case "EFF_NO_RESET_ROUND":
        card!.noResetRound = state.round;
        log(`${name} 本輪輪末無法重置`);
        break;
      case "EFF_RESET":
        card!.tapped = false;
        log(`重置 ${name}`);
        break;
      case "ITEM_TOKEN_TIER_RESULT": {
        const m = state.mission!;
        const tokens = Object.values(itemTokens).reduce((s, n) => s + n, 0);
        if (tokens >= 7) {
          m.resultTimes *= 2;
          log(`${label}：${tokens} 個指示物，骰子總和兩倍`);
        } else if (tokens >= 4) {
          m.resultDelta += 5;
          log(`${label}：${tokens} 個指示物，骰子總和 +5`);
        } else if (tokens >= 1) {
          m.resultDelta += 1;
          log(`${label}：${tokens} 個指示物，骰子總和 +1`);
        } else {
          log(`${label}：沒有指示物，沒有效果`);
        }
        break;
      }
    }
  }
}

/** 道具的指定：道具沒有特質，只受公會層級的保護影響（梭、威利）。 */
function canTargetByItem(state: GameState, lib: CardLibrary, p: PlayerState, target: string): boolean {
  const owner = ab.ownerOf(state, target);
  if (!owner) return false;
  if (owner.id === p.id) return true;
  if (owner.adventurers.some((u) => ab.has(state, lib, u, "GUILD_UNTARGETABLE"))) return false;
  const guard = owner.adventurers.find((u) => ab.has(state, lib, u, "REDIRECT_TARGETING"));
  return !guard || guard === target;
}
