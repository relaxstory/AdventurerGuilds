/**
 * 主動能力（「代價：效果」）與玩家決定（docs/spec.md 13A）。
 */
import * as ab from "./abilities.js";
import { RULES } from "./constants.js";
import type { CardLibrary, ClauseDef } from "./defs.js";
import { RuleError } from "./errors.js";
import type { Rng } from "./rng.js";
import { consumeCategory, countCategory, discardItem, gainItem, splitList } from "./items.js";
import type { GameState, PlayerState } from "./state.js";

/** 發動主動能力時提供的參數，依效果而定。 */
export interface ActivateParams {
  /** 要發動的冒險者。 */
  readonly card: string;
  /** 技能名稱，例如「【天羅地網】」。 */
  readonly skill: string;
  /** 指定的冒險者（重置、橫置、棄置、加入任務）。 */
  readonly targets?: readonly string[];
  /** 選擇的玩家（布魯斯、里諾）。 */
  readonly player?: string;
  /** 從任務棄置區取回的任務（布萊克）。 */
  readonly task?: string;
  /** 從酒館招募的位置（巴爾）。 */
  readonly tavernIndex?: number;
  /** 放置的指示物數量（傑米）；轉換道具的數量（漢克）。 */
  readonly count?: number;
  /** 要獲得的道具名稱（伊蓮娜）。 */
  readonly item?: string;
}

export type Decision =
  | { readonly option: "tap"; readonly target: string }
  | { readonly option: "pay" }
  | { readonly option: "flip" }
  /** 道具區超過上限：捨棄這個道具。 */
  | { readonly option: "discard"; readonly target: string }
  /** 選擇要獲得的道具。 */
  | { readonly option: "item"; readonly name: string }
  /** 不拿（選擇性的效果）。 */
  | { readonly option: "skip" }
  /** 選擇一名玩家。 */
  | { readonly option: "player"; readonly target: string };

type Log = (text: string) => void;

const EFFECTS = new Set([
  "EFF_GAIN", "EFF_RESET", "EFF_FLIP_SELF", "EFF_RETRIEVE_TASK", "EFF_DISCARD_RECRUIT", "EFF_OPPONENT_TAP_OR_PAY",
  "EFF_OPPONENT_TAP_OR_FLIP", "EFF_TAP_WITH_TRAIT", "EFF_ADD_TOKENS_SELF", "EFF_REMOVE_TOKENS_SELF", "ADD_PARTICIPANT",
  "EFF_GAIN_ITEM_CHOICE", "EFF_CONVERT_ITEMS", "EFF_CREATE_ITEM_MOVE_TOKENS",
]);

/** 冒險者的主動能力：有 COST 子句的技能。回傳技能名稱 → 子句。 */
export function activatedSkills(state: GameState, lib: CardLibrary, uid: string): Map<string, ClauseDef[]> {
  const out = new Map<string, ClauseDef[]>();
  const all = ab.clausesOf(state, lib, uid);
  for (const skill of new Set(all.filter((c) => c.code === "COST").map((c) => c.skill))) {
    out.set(skill, all.filter((c) => c.skill === skill));
  }
  return out;
}

/** 這個主動能力是否已經實作（所有效果子句都已實作）。 */
export function activationImplemented(clauses: readonly ClauseDef[]): boolean {
  return clauses.every((c) => c.code === "COST" || c.code === "TIMING" || EFFECTS.has(c.code));
}

const upright = (state: GameState, uid: string) => !state.adventurerCards[uid]!.tapped;

function sameTargets(targets: readonly string[] | undefined, max: number, label: string): readonly string[] {
  const t = targets ?? [];
  if (t.length < 1 || t.length > max) throw new RuleError(`${label}：請指定 1～${max} 名冒險者`);
  if (new Set(t).size !== t.length) throw new RuleError(`${label}：不能重複指定同一名冒險者`);
  return t;
}

/** 發動主動能力：檢查時機、代價與目標，支付代價後執行效果。 */
export function activate(state: GameState, lib: CardLibrary, rng: Rng, p: PlayerState, a: ActivateParams, log: Log): void {
  if (!p.adventurers.includes(a.card)) throw new RuleError("只能發動自己公會中冒險者的能力");
  const skills = activatedSkills(state, lib, a.card);
  const clauses = skills.get(a.skill);
  const name = ab.faceOf(state, lib, a.card).name;
  if (!clauses) throw new RuleError(`${name} 沒有主動能力 ${a.skill}`);
  if (!activationImplemented(clauses)) throw new RuleError(`${name} 的 ${a.skill} 尚未實作`);
  const label = `${name}${a.skill}`;
  const cost = clauses.find((c) => c.code === "COST")!;
  const effects = clauses.filter((c) => EFFECTS.has(c.code));
  const joining = effects.some((c) => c.code === "ADD_PARTICIPANT");

  // 時機：只能在自己的回合（公會階段、冒險階段）；加入任務只能在派遣的組隊步驟
  const timing = clauses.find((c) => c.code === "TIMING")?.x;
  if (state.phase !== "guild" && state.phase !== "adventure") throw new RuleError("主動能力只能在公會階段或冒險階段使用");
  if (timing === "公會階段" && state.phase !== "guild") throw new RuleError(`${label} 只能在公會階段使用`);
  if (timing === "回合開始時" && !state.turnStartOpen) throw new RuleError(`${label} 只能在回合開始時使用`);
  if (joining ? state.mission?.stage !== "assemble" : state.mission) {
    throw new RuleError(joining ? `${label} 只能在派遣的組隊步驟使用` : "派遣進行中，不能發動這個能力");
  }

  // 代價：冒號前面的部分必須付得出來
  const tapCost = cost.x.includes("橫置");
  const goldCost = Number(cost.y || 0);
  if (tapCost && !upright(state, a.card)) throw new RuleError(`${name} 已經橫置，無法支付代價`);
  if (p.gold < goldCost) throw new RuleError(`金幣不足：需要 ${goldCost} 金`);
  // 消耗道具作為代價，例如伊蓮娜「銷毀兩個 [藥材]」
  const itemCost = cost.z.match(/^(\d+)\s*(.+)$/);
  if (itemCost && countCategory(state, lib, p, itemCost[2]!) < Number(itemCost[1])) {
    throw new RuleError(`${label}：需要 ${itemCost[1]} 個 ${itemCost[2]}`);
  }

  // 先檢查效果的目標（沒有合法目標就不能發動，也不能先付代價）
  const max = 1 + ab.targetBonus(state, lib, p);
  const plan: (() => void)[] = [];
  for (const c of effects) {
    switch (c.code) {
      case "EFF_GAIN":
        plan.push(() => ab.gain(p, ab.amount(state, lib, a.card, c.x), c.y, log, label));
        break;
      case "EFF_RESET": {
        const targets = sameTargets(a.targets, ab.amount(state, lib, a.card, c.x) + max - 1, label);
        for (const t of targets) if (!ab.canTarget(state, lib, a.card, p.id, t)) throw new RuleError(`${label}：不能指定 ${ab.faceOf(state, lib, t).name}`);
        plan.push(() => {
          for (const t of targets) state.adventurerCards[t]!.tapped = false;
          log(`${label}：重置 ${targets.map((t) => ab.faceOf(state, lib, t).name).join("、")}`);
        });
        break;
      }
      case "EFF_TAP_WITH_TRAIT": {
        const targets = sameTargets(a.targets, max, label);
        for (const t of targets) {
          const f = ab.faceOf(state, lib, t);
          if (!f.traits.some((x) => x.replace(/[\[\]]/g, "") === c.x.replace(/[\[\]]/g, ""))) throw new RuleError(`${label}：${f.name} 沒有 ${c.x} 特質`);
          if (!upright(state, t)) throw new RuleError(`${label}：${f.name} 不是直立狀態`);
          if (!ab.canTarget(state, lib, a.card, p.id, t)) throw new RuleError(`${label}：不能指定 ${f.name}`);
        }
        plan.push(() => {
          for (const t of targets) state.adventurerCards[t]!.tapped = true;
          log(`${label}：橫置 ${targets.map((t) => ab.faceOf(state, lib, t).name).join("、")}`);
        });
        break;
      }
      case "EFF_FLIP_SELF":
        plan.push(() => ab.flip(state, lib, a.card, p.id, log));
        break;
      case "EFF_RETRIEVE_TASK": {
        const t = a.task;
        if (!t || !state.taskDiscard.includes(t)) throw new RuleError(`${label}：請從任務棄置區選擇一張任務`);
        const stagingMax = p.upgraded ? RULES.stagingSlots.upgraded : RULES.stagingSlots.base;
        if (p.staging.length >= stagingMax) throw new RuleError(`${label}：任務暫存格已滿`);
        plan.push(() => {
          state.taskDiscard = state.taskDiscard.filter((x) => x !== t);
          state.taskCards[t]!.attempts = 0;
          p.staging.push(t);
          log(`${label}：從任務棄置區取回「${lib.task(state.taskCards[t]!.defKey).name}」`);
        });
        break;
      }
      case "EFF_DISCARD_RECRUIT": {
        const [out] = sameTargets(a.targets, 1, label);
        if (!p.adventurers.includes(out!)) throw new RuleError(`${label}：只能棄置自己公會中的冒險者`);
        const i = a.tavernIndex ?? -1;
        if (!state.tavern[i] || state.tavern[i] === out) throw new RuleError(`${label}：請選擇酒館中的冒險者`);
        plan.push(() => {
          const recruit = state.tavern[i]!;
          p.adventurers = p.adventurers.filter((u) => u !== out);
          const card = state.adventurerCards[out!]!;
          card.tapped = false;
          for (const u of ab.members(state, out!)) state.adventurerCards[u]!.tokens = {}; // 進入棄置區時移除指示物
          state.adventurerDiscard.push(out!);
          state.tavern.splice(i, 1);
          const next = state.adventurerDeck.shift();
          if (next) state.tavern.push(next);
          p.adventurers.push(recruit);
          log(`${label}：${ab.faceOf(state, lib, out!).name} 退役，招募 ${ab.faceOf(state, lib, recruit).name}`);
          ab.onRecruit(state, lib, p, recruit, log);
        });
        break;
      }
      case "EFF_OPPONENT_TAP_OR_PAY":
      case "EFF_OPPONENT_TAP_OR_FLIP": {
        const other = state.players.find((x) => x.id === a.player);
        if (!other || other.id === p.id) throw new RuleError(`${label}：請選擇一名其他玩家`);
        const amount = c.code === "EFF_OPPONENT_TAP_OR_PAY" ? ab.amount(state, lib, a.card, c.x) : 0;
        plan.push(() => {
          const canTap = other.adventurers.some((u) => upright(state, u));
          const canOther = c.code === "EFF_OPPONENT_TAP_OR_PAY" ? other.gold >= amount : ab.canFlip(state, lib, a.card);
          log(`${label}：${other.name} 必須選擇一項`);
          if (!canTap && !canOther) {
            log(`${other.name} 兩個選項都無法執行，沒有效果`);
            return;
          }
          state.pending =
            c.code === "EFF_OPPONENT_TAP_OR_PAY"
              ? { kind: "tapOrPay", player: other.id, from: p.id, amount, source: a.card }
              : { kind: "tapOrFlip", player: other.id, from: p.id, source: a.card };
        });
        break;
      }
      case "EFF_ADD_TOKENS_SELF": {
        const n = a.count ?? ab.amount(state, lib, a.card, c.x);
        const limit = ab.amount(state, lib, a.card, c.x);
        if (!Number.isInteger(n) || n < 1 || n > limit) throw new RuleError(`${label}：可以放 1～${limit} 個指示物`);
        plan.push(() => ab.addTokens(state, lib, a.card, c.y, n, log, rng));
        break;
      }
      case "EFF_REMOVE_TOKENS_SELF":
        plan.push(() => {
          delete state.adventurerCards[a.card]!.tokens[c.x];
          log(`${label}：移除所有${c.x}指示物`);
        });
        break;
      case "EFF_GAIN_ITEM_CHOICE": {
        const options = splitList(c.x);
        if (!a.item || !options.includes(a.item)) throw new RuleError(`${label}：請選擇 ${options.join("、")} 其中一種`);
        plan.push(() => gainItem(state, lib, p, a.item!, log));
        break;
      }
      case "EFF_CONVERT_ITEMS": {
        const limit = ab.amount(state, lib, a.card, c.x);
        const n = a.count ?? Math.min(limit, countCategory(state, lib, p, c.y));
        if (!Number.isInteger(n) || n < 1 || n > limit) throw new RuleError(`${label}：可以轉換 1～${limit} 個 ${c.y}`);
        if (countCategory(state, lib, p, c.y) < n) throw new RuleError(`${label}：${c.y} 不足 ${n} 個`);
        plan.push(() => {
          consumeCategory(state, lib, p, n, c.y, log);
          for (let i = 0; i < n; i++) gainItem(state, lib, p, c.z, log);
        });
        break;
      }
      case "EFF_CREATE_ITEM_MOVE_TOKENS":
        plan.push(() => {
          const card = state.adventurerCards[a.card]!;
          const moved = card.tokens[c.y] ?? 0;
          delete card.tokens[c.y];
          gainItem(state, lib, p, c.x, log, moved ? { [c.y]: moved } : {});
          if (moved) log(`${moved} 個${c.y}指示物轉移到【${c.x}】`);
        });
        break;
      case "ADD_PARTICIPANT": {
        const m = state.mission!;
        const targets = sameTargets(a.targets, ab.amount(state, lib, a.card, c.x) + max - 1, label);
        for (const t of targets) {
          if (!p.adventurers.includes(t) || t === a.card) throw new RuleError(`${label}：只能指定自己公會中的其他冒險者`);
          if (!upright(state, t)) throw new RuleError(`${label}：${ab.faceOf(state, lib, t).name} 不是直立狀態`);
          if (ab.participants(m).includes(t)) throw new RuleError(`${label}：${ab.faceOf(state, lib, t).name} 已經在這次任務中`);
        }
        const problem = ab.participationProblem(state, lib, [...ab.participants(m), ...targets]);
        if (problem) throw new RuleError(problem);
        plan.push(() => {
          m.joined.push(...targets);
          log(`${label}：${targets.map((t) => ab.faceOf(state, lib, t).name).join("、")} 加入這次任務（不視為派遣）`);
        });
        break;
      }
    }
  }

  // 支付代價，然後依序執行效果
  if (tapCost) state.adventurerCards[a.card]!.tapped = true;
  p.gold -= goldCost;
  if (itemCost) consumeCategory(state, lib, p, Number(itemCost[1]), itemCost[2]!, log);
  log(`發動 ${label}${tapCost ? "，橫置" : ""}${goldCost ? `，支付 ${goldCost} 金` : ""}`);
  for (const step of plan) step();
}

/** 玩家做出 pending 要求的決定。 */
export function decide(state: GameState, lib: CardLibrary, d: Decision, log: (player: string, text: string) => void): void {
  const pending = state.pending;
  if (!pending) throw new RuleError("目前不需要做決定");
  const who = state.players.find((x) => x.id === pending.player)!;
  const say = (text: string) => log(who.id, text);
  const ownUpright = (t: string) => who.adventurers.includes(t) && !state.adventurerCards[t]!.tapped;
  state.pending = null;
  resolveDecision(state, lib, pending, d, who, say, ownUpright);
  // 下一個排隊中的決定
  if (!state.pending && state.pendingQueue.length) state.pending = state.pendingQueue.shift()!;
}

function resolveDecision(
  state: GameState,
  lib: CardLibrary,
  pending: NonNullable<GameState["pending"]>,
  d: Decision,
  who: PlayerState,
  say: (text: string) => void,
  ownUpright: (t: string) => boolean,
): void {
  switch (pending.kind) {
    case "tapOrPay":
    case "tapOrFlip": {
      if (d.option === "tap") {
        // 對手依效果選擇自己的冒險者，不屬於「指定」（G6）
        if (!ownUpright(d.target)) throw new RuleError("請選擇自己公會中的一名直立冒險者");
        state.adventurerCards[d.target]!.tapped = true;
        say(`選擇橫置 ${ab.faceOf(state, lib, d.target).name}`);
      } else if (d.option === "pay" && pending.kind === "tapOrPay") {
        if (who.gold < pending.amount) throw new RuleError(`金幣不足：需要 ${pending.amount} 金`);
        who.gold -= pending.amount;
        state.players.find((x) => x.id === pending.from)!.gold += pending.amount;
        say(`選擇支付 ${pending.amount} 金`);
      } else if (d.option === "flip" && pending.kind === "tapOrFlip") {
        if (!ab.canFlip(state, lib, pending.source)) throw new RuleError("這張卡無法翻面");
        say(`選擇讓 ${ab.faceOf(state, lib, pending.source).name} 翻面`);
        ab.flip(state, lib, pending.source, who.id, say);
      } else {
        throw new RuleError("這不是可以選擇的選項");
      }
      break;
    }
    case "tapTarget": {
      if (d.option !== "tap" || !pending.targets.includes(d.target)) throw new RuleError("請從可以指定的冒險者中選擇");
      state.adventurerCards[d.target]!.tapped = true;
      say(`${ab.faceOf(state, lib, pending.source).name}：橫置 ${ab.faceOf(state, lib, d.target).name}`);
      break;
    }
    case "discardItem": {
      if (d.option !== "discard" || !pending.items.includes(d.target)) throw new RuleError("道具區已滿，請選擇一個道具捨棄");
      discardItem(state, lib, who, d.target, say);
      break;
    }
    case "chooseItem": {
      if (d.option === "skip" && pending.optional) {
        say("選擇不拿道具");
        break;
      }
      if (d.option !== "item" || !pending.options.includes(d.name)) throw new RuleError(`請選擇 ${pending.options.join("、")} 其中一種`);
      gainItem(state, lib, who, d.name, say);
      break;
    }
    case "givePlayer": {
      const target = state.players.find((x) => x.id === (d.option === "player" ? d.target : ""));
      if (!target || target.id === who.id) throw new RuleError("請選擇一名其他玩家");
      gainItem(state, lib, target, pending.item, say);
      say(`把【${pending.item}】放在 ${target.name} 面前`);
      break;
    }
  }
}
