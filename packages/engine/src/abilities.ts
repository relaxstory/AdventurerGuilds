/**
 * 卡片能力：依技能子句（docs/abilities.md）查詢修正值、觸發效果。
 *
 * 每個子句對應一個技能模板。常駐效果以「查詢」方式計算（例如難度調整），
 * 觸發效果在規則流程的固定時機呼叫（例如任務結算時）。
 */
import type { ClauseDef, CardLibrary, TaskDef } from "./defs.js";
import { turnOptions } from "./dice.js";
import { RuleError } from "./errors.js";
import type { Rng } from "./rng.js";
import { countCategory, consumeCategory, gainItem, splitList } from "./items.js";
import { destroyAdventurer, workshopOptions } from "./lifecycle.js";
import type { GameState, Mission, Pending, PlayerState } from "./state.js";

/** 已實作的技能模板。其餘模板在對應的開發批次完成（docs/development.md）。 */
export const IMPLEMENTED = new Set([
  "COND_HAS_CARDS",
  "NO_ROUND_RESET", "NO_TAP_FIRST_DISPATCH", "NO_TAP_DISPATCH", "DISPATCH_ADD_TOKEN_NO_TAP",
  "DICE_PER_TOKEN", "TOKEN_THRESHOLD_FLIP", "DISPATCH_LIMIT_PER_TURN", "CANNOT_BE_FIRED", "NOT_COUNT_CAPACITY",
  "CANNOT_PARTICIPATE_WITH", "COUNTS_AS_RACE", "ANY_PROFESSION", "FREE_RECRUIT_IF_NAME", "MUST_PARTICIPATE_FIRST",
  "TASK_DIFFICULTY", "WITH_CARD_DIFFICULTY", "WITH_PROFESSION_DICE", "WITH_CARD_DICE", "TASK_BASE_DICE",
  "AFTER_ROLL_RESULT_MOD", "AFTER_ROLL_REMOVE_FACE", "PER_REMOVED_DIE_GAIN",
  "PARTICIPATE_GAIN", "WITH_CARD_GAIN", "COMPLETE_GAIN", "SETTLE_PARITY_GAIN", "SETTLE_IF_TAPPED_GAIN", "SETTLE_GAIN",
  "COMPLETE_IN_SLOT_GAIN", "SALARY_WAIVE_LOWER", "TAP_SELF_IF_WAIVED",
  "ROUNDEND_IF_TAPPED_GAIN", "ROUNDEND_IF_UPRIGHT_TOKEN", "TURNEND_IF_UPRIGHT_TAP_PAY", "ON_RECRUIT_GAIN",
  // M3-2：需要玩家選擇的能力
  "PREDICT_PARITY", "BASE_DICE_CHOICE", "AFTER_ROLL_REROLL", "AFTER_ROLL_TURN", "AFTER_ROLL_REMOVE_DICE",
  "GAMBLE_REROLL", "RESULT_ADJUST",
  // M3-3：主動能力、指定與保護、跨玩家選擇、翻面
  "COST", "TIMING", "EFF_GAIN", "EFF_RESET", "EFF_FLIP_SELF", "EFF_RETRIEVE_TASK", "EFF_DISCARD_RECRUIT",
  "EFF_OPPONENT_TAP_OR_PAY", "EFF_OPPONENT_TAP_OR_FLIP", "EFF_TAP_WITH_TRAIT", "EFF_ADD_TOKENS_SELF", "TOKEN_PLACED_RISK",
  "EFF_REMOVE_TOKENS_SELF", "ADD_PARTICIPANT", "UNTARGETABLE_BY_TRAIT", "REDIRECT_TARGETING", "GUILD_UNTARGETABLE",
  "TARGET_COUNT_PLUS", "ON_FLIP_TAP_FLIPPER", "ON_RETURN_TAVERN_FLIP", "ON_FLIP_RECRUIT_SELF",
  // M3-4a：道具
  "ITEM_CONSUME", "EFF_BASE_DICE_ROUND", "EFF_NO_RESET_ROUND", "ITEM_TOKEN_TIER_RESULT", "CONSUME_ALL_TIER_GAIN",
  "SUBSTITUTE_ITEM", "WHILE_HELD_NO_TAP_FIRST", "SELL_PRICE_MOD", "EXTRA_ITEM_SLOT", "ON_RECRUIT_GAIN_ITEM",
  "ON_RECRUIT_GIVE_ITEM", "COMPLETE_GAIN_ITEM", "ON_ANY_COMPLETE_TAG_ITEM", "TURNEND_GAIN_ITEM", "EFF_GAIN_ITEM_CHOICE",
  "EFF_CONVERT_ITEMS", "EFF_CREATE_ITEM_MOVE_TOKENS", "AFTER_ROLL_AUTO_SUCCESS",
  // M3-4b：新兵小隊
  "SQUAD", "SQUAD_DICE", "SQUAD_SALARY", "SQUAD_COMPLETE_GAIN", "SQUAD_RESULT_ADJUST", "SQUAD_DIFFICULTY",
  // M3-4c：衍生物與銷毀
  "ON_RECRUIT_WORKSHOP", "EFF_CREATE_FROM_WORKSHOP", "ON_CREATE_TRANSFER_TOKENS", "ROUNDEND_DESTROY_SELF",
  "EFF_TAP_BASE_DICE_BELOW", "EFF_TRANSFER_TOKENS_DESTROY", "SETTLE_RESET", "WITH_CARD_DESTROY_AFTER",
  "TURNSTART_CREATE_TOKEN", "TURNSTART_TASK_TIME", "ON_DESTROY_GAIN", "REPLACE_DESTROY_ALLY",
  "REPLACE_DESTROY_UNIQUE_ITEM", "ON_REP_DECREASE_DESTROY",
  // M3-4d：特殊能力
  "GUARD_REDIRECT", "EFF_FLIP_DOUBLE_TEMP", "EFF_COPY_ABILITY", "SHUFFLE_BACK_WITH", "TASK_AUTO_COMPLETE_TRAIT",
]);

/**
 * 守門員小嗶【不可以過！】：其他玩家要以「不利」的效果指定你的冒險者時，改為指定守門員小嗶。
 * 發動能力的玩家擲 1 顆骰子，結果未大於精工指示物數時取消該次能力；之後銷毀守門員小嗶。
 * 不論取消或轉移，原本的目標都不受影響，所以回傳 false（目標不受影響）或 true（照常生效）。
 * 簡化：守門員小嗶一定會被使用（它在輪末就會被銷毀，保留沒有好處）。
 */
export function passesGuard(state: GameState, lib: CardLibrary, rng: Rng, actor: string, target: string, log: Log): boolean {
  const owner = ownerOf(state, target);
  if (!owner || owner.id === actor) return true;
  const guard = owner.adventurers.find((u) => u !== target && has(state, lib, u, "GUARD_REDIRECT"));
  if (!guard) return true;
  const limit = amount(state, lib, guard, clauses(state, lib, guard, "GUARD_REDIRECT")[0]!.x);
  const roll = rng.d6();
  log(`${faceOf(state, lib, guard).name}【不可以過！】：改為指定它，擲出 ${roll}${roll <= limit ? `，未大於 ${limit}，取消該次能力` : `，大於 ${limit}，能力打在守門員小嗶身上`}`);
  destroyAdventurer(state, lib, guard, log, false);
  return false;
}

// ── 新兵小隊（docs/spec.md 12）──

/** 小隊的所有成員（隊長在最前面）；不是小隊時只有自己。 */
export function members(state: GameState, uid: string): string[] {
  return [uid, ...(state.adventurerCards[uid]!.squad ?? [])];
}

/** 可以組成小隊的冒險者：有【集結】，名字含指定關鍵字（例如「新兵」）。 */
export function squadKeyword(state: GameState, lib: CardLibrary, uid: string): string | null {
  return clauses(state, lib, uid, "SQUAD")[0]?.x || null;
}

/** 小隊中的士兵數（隊長能力「每有 X 名士兵」）。 */
function soldiers(state: GameState, lib: CardLibrary, uid: string): number {
  return members(state, uid).filter((u) => professionMatches(state, lib, u, "士兵")).length;
}

/** 隊長能力的倍數：每有 X 名士兵，效果 1 次。 */
function perSoldiers(state: GameState, lib: CardLibrary, uid: string, c: ClauseDef): number {
  return Math.floor(soldiers(state, lib, uid) / Math.max(1, amount(state, lib, uid, c.x))) * amount(state, lib, uid, c.y);
}

/** 一個冒險者（或一整支小隊）的基礎骰數：小隊為全隊加總。 */
export function unitBaseDice(state: GameState, lib: CardLibrary, uid: string): number {
  return members(state, uid).reduce((s, u) => s + Math.max(0, faceOf(state, lib, u).baseDice ?? 0), 0);
}

/** 一個冒險者（或一整支小隊）的薪資：小隊只付隊長的薪資，再套用隊長能力。 */
export function unitSalary(state: GameState, lib: CardLibrary, uid: string): number {
  let salary = Math.max(0, faceOf(state, lib, uid).salary ?? 0);
  for (const c of clauses(state, lib, uid, "SQUAD_SALARY")) salary += perSoldiers(state, lib, uid, c);
  return Math.max(0, salary);
}

/** 加入等待中的決定；已經有決定在等時排隊。 */
export function pushPending(state: GameState, p: Pending): void {
  if (state.pending) state.pendingQueue.push(p);
  else state.pending = p;
}

type Log = (text: string) => void;

// ── 基本查詢 ──

export function faceOf(state: GameState, lib: CardLibrary, uid: string) {
  const card = state.adventurerCards[uid];
  if (!card) throw new Error(`找不到冒險者 ${uid}`);
  return lib.adventurer(card.face === "back" ? `${card.defId}B` : card.defId);
}

export function ownerOf(state: GameState, uid: string): PlayerState | undefined {
  return state.players.find((p) => p.adventurers.includes(uid));
}

const norm = (s: string) => s.replace(/[\s「」]/g, "");
const sameName = (a: string, b: string) => norm(a) === norm(b);
const bare = (s: string) => s.replace(/^[\[［【](.*)[\]］】]$/, "$1").replace(/\(B\)$/, "");

/**
 * 冒險者目前有效的技能子句。COND_HAS_CARDS（例如青蛙合唱團的和弦）不成立時，
 * 同一技能的後續子句無效。
 */
export function clausesOf(state: GameState, lib: CardLibrary, uid: string): ClauseDef[] {
  const face = faceOf(state, lib, uid);
  const owner = ownerOf(state, uid);
  const out: ClauseDef[] = [];
  let blocked: string | null = null;
  for (const c of lib.clauses(face)) {
    if (blocked === c.skill) continue;
    blocked = null;
    if (c.code === "COND_HAS_CARDS") {
      const names = owner ? owner.adventurers.map((u) => faceOf(state, lib, u).name) : [];
      const ok = [c.x, c.y].filter(Boolean).every((n) => names.some((m) => sameName(m, n)));
      if (!ok) blocked = c.skill;
      continue;
    }
    out.push(c);
  }
  return out;
}

export function clauses(state: GameState, lib: CardLibrary, uid: string, code: string): ClauseDef[] {
  return clausesOf(state, lib, uid).filter((c) => c.code === code);
}

export const has = (state: GameState, lib: CardLibrary, uid: string, code: string) => clauses(state, lib, uid, code).length > 0;

/** 數值參數：整數，或依指示物計算（例如「精工」「精工/2」）。 */
export function amount(state: GameState, lib: CardLibrary, uid: string, param: string): number {
  const v = param.trim();
  if (/^[-+]?\d+$/.test(v)) return Number(v);
  const card = state.adventurerCards[uid];
  const owner = ownerOf(state, uid);
  if (v === "橫置冒險者數") return owner ? owner.adventurers.filter((u) => state.adventurerCards[u]!.tapped).length : 0;
  if (v === "完成區任務數×2") return owner ? owner.completed.length * 2 : 0;
  const m = v.match(/^(.+?)(?:\/(\d+))?$/);
  if (m && card) {
    const tokens = card.tokens[m[1]!] ?? 0;
    return m[2] ? Math.floor(tokens / Number(m[2])) : tokens;
  }
  void lib;
  return 0;
}

/** 任務條件參數：空白為任何任務；[標籤]；任務類型；「有嘗試指示物」。 */
export function taskMatches(param: string, def: TaskDef, attempts: number): boolean {
  const v = param.trim();
  if (v === "") return true;
  if (v === "有嘗試指示物") return attempts > 0;
  if (/^[\[［]/.test(v)) return def.tags.some((t) => bare(t) === bare(v));
  return def.type === v;
}

export function raceOf(state: GameState, lib: CardLibrary, uid: string): string {
  const own = clauses(state, lib, uid, "COUNTS_AS_RACE")[0];
  return own ? bare(own.x) : bare(faceOf(state, lib, uid).race);
}

export function professionMatches(state: GameState, lib: CardLibrary, uid: string, profession: string): boolean {
  if (has(state, lib, uid, "ANY_PROFESSION")) return true;
  return bare(faceOf(state, lib, uid).profession) === bare(profession);
}

export function gain(p: PlayerState, value: number, resource: string, log: Log, source: string): void {
  if (!value) return;
  if (resource === "聲望") p.reputation += value;
  else p.gold = Math.max(0, p.gold + value);
  log(`${source}：${resource} ${value > 0 ? "+" : ""}${value}`);
}

// ── 公會階段 ──

/** 佔用冒險者容量的人數（docs/spec.md 3.2）。 */
export function capacityUsed(state: GameState, lib: CardLibrary, p: PlayerState): number {
  return p.adventurers.filter((u) => !state.adventurerCards[u]!.derivative && !has(state, lib, u, "NOT_COUNT_CAPACITY")).length;
}

export function canBeFired(state: GameState, lib: CardLibrary, uid: string): boolean {
  return !has(state, lib, uid, "CANNOT_BE_FIRED");
}

/** 招募這名冒險者是否不需消耗公會行動（青蛙合唱團【共鳴】）。 */
export function freeRecruit(state: GameState, lib: CardLibrary, p: PlayerState, uid: string): boolean {
  return clauses(state, lib, uid, "FREE_RECRUIT_IF_NAME").some((c) =>
    p.adventurers.some((u) => norm(faceOf(state, lib, u).name).includes(norm(c.x))),
  );
}

export function onRecruit(state: GameState, lib: CardLibrary, p: PlayerState, uid: string, log: Log): void {
  const name = faceOf(state, lib, uid).name;
  for (const c of clauses(state, lib, uid, "ON_RECRUIT_GAIN")) gain(p, amount(state, lib, uid, c.x), c.y, log, name);
  for (const c of clauses(state, lib, uid, "ON_RECRUIT_GAIN_ITEM")) gainItem(state, lib, p, c.x, log);
  for (const c of clauses(state, lib, uid, "ON_RECRUIT_WORKSHOP")) {
    const options = workshopOptions(lib, c.x);
    const count = amount(state, lib, uid, c.y);
    if (options.length <= count) state.adventurerCards[uid]!.workshop = options;
    else pushPending(state, { kind: "chooseWorkshop", player: p.id, source: uid, options, count });
  }
  for (const c of clauses(state, lib, uid, "ON_RECRUIT_GIVE_ITEM")) {
    if (state.players.length > 1) pushPending(state, { kind: "givePlayer", player: p.id, item: c.x, source: uid });
  }
}

// ── 派遣 ──

/** 派遣時是否橫置；回傳 false 表示不需橫置（並處理放置指示物）。 */
export function tapOnDispatch(state: GameState, lib: CardLibrary, uid: string, log: Log): boolean {
  const card = state.adventurerCards[uid]!;
  const name = faceOf(state, lib, uid).name;
  const token = clauses(state, lib, uid, "DISPATCH_ADD_TOKEN_NO_TAP")[0];
  if (token) {
    addTokens(state, lib, uid, token.y, amount(state, lib, uid, token.x), log);
    return false;
  }
  if (has(state, lib, uid, "NO_TAP_DISPATCH")) return false;
  // 父親的家書：持有時，芙蕾雅每輪第一次被派遣時不需橫置
  const owner = ownerOf(state, uid);
  const letter = owner?.items.some((i) =>
    lib.clauses(lib.item(state.itemCards[i]!.name)).some((c) => c.code === "WHILE_HELD_NO_TAP_FIRST" && sameName(c.x, name)),
  );
  if ((has(state, lib, uid, "NO_TAP_FIRST_DISPATCH") || letter) && card.freeDispatchRound !== state.round) {
    card.freeDispatchRound = state.round;
    log(`${name} 本輪第一次派遣，不需橫置`);
    return false;
  }
  return true;
}

export function addTokens(state: GameState, lib: CardLibrary, uid: string, token: string, n: number, log: Log, rng?: Rng): void {
  if (n <= 0) return;
  const card = state.adventurerCards[uid]!;
  card.tokens[token] = (card.tokens[token] ?? 0) + n;
  const name = faceOf(state, lib, uid).name;
  log(`${name} 放置 ${n} 個${token}指示物（共 ${card.tokens[token]} 個）`);
  // 傑米【別爆別爆別爆……】：放上指示物時擲等量的骰子，骰出指定點數就移除所有指示物
  for (const c of clauses(state, lib, uid, "TOKEN_PLACED_RISK")) {
    if (c.x !== token || !rng) continue;
    const dice = rng.rollDice(n);
    const bad = amount(state, lib, uid, c.y);
    if (dice.includes(bad)) {
      delete card.tokens[token];
      log(`${name} 擲出 ${dice.join("、")}，出現 ${bad}：移除所有${token}指示物`);
      return;
    }
    log(`${name} 擲出 ${dice.join("、")}，沒有出現 ${bad}`);
  }
  for (const c of clauses(state, lib, uid, "TOKEN_THRESHOLD_FLIP")) {
    if (c.x === token && card.tokens[token]! >= amount(state, lib, uid, c.y)) {
      card.tapped = true;
      delete card.tokens[token];
      log(`${name} 的${token}指示物達到 ${c.y} 個：橫置並翻面`);
      const owner = ownerOf(state, uid);
      flip(state, lib, uid, owner?.id ?? null, log);
    }
  }
}

// ── 翻面 ──

/** 雙面卡的另一面是否存在。 */
export function canFlip(state: GameState, lib: CardLibrary, uid: string): boolean {
  const card = state.adventurerCards[uid]!;
  if (card.flipLock) return false; // 菲特的能力結束前不能再翻面
  const other = card.face === "front" ? `${card.defId}B` : card.defId;
  return lib.adventurers.has(other);
}

/**
 * 翻面，並觸發新的一面的「當此冒險者被翻面時」效果。
 * flipper 是使其翻面的玩家（狂人里諾、賴皮的勇者會用到）。
 */
export function flip(state: GameState, lib: CardLibrary, uid: string, flipper: string | null, log: Log): void {
  if (!canFlip(state, lib, uid)) return;
  const card = state.adventurerCards[uid]!;
  card.face = card.face === "front" ? "back" : "front";
  const name = faceOf(state, lib, uid).name;
  log(`翻面為 ${name}`);
  const owner = ownerOf(state, uid);
  // 狂人里諾【我給過你機會了】：橫置使其翻面的玩家公會中的一名直立冒險者（由擁有者指定）
  if (has(state, lib, uid, "ON_FLIP_TAP_FLIPPER") && owner && flipper) {
    const target = state.players.find((p) => p.id === flipper);
    const targets = (target?.adventurers ?? []).filter(
      (u) => !state.adventurerCards[u]!.tapped && canTarget(state, lib, uid, owner.id, u),
    );
    if (targets.length) pushPending(state, { kind: "tapTarget", player: owner.id, source: uid, targets });
    else log(`${name} 沒有可以指定的目標，沒有效果`);
  }
  // 賴皮的勇者【賴著不走】：在酒館被翻面時，使其翻面的玩家立即額外招募他
  if (has(state, lib, uid, "ON_FLIP_RECRUIT_SELF") && !owner && flipper) {
    const i = state.tavern.indexOf(uid);
    const p = state.players.find((x) => x.id === flipper);
    if (i >= 0 && p) {
      state.tavern.splice(i, 1);
      const next = state.adventurerDeck.shift();
      if (next) state.tavern.push(next);
      p.adventurers.push(uid);
      log(`${name} 賴著不走，被額外招募回公會`);
    }
  }
}

/** 冒險者被放回酒館時（勇者【卸甲歸田】）。flipper 為使其回到酒館的玩家。 */
export function onReturnToTavern(state: GameState, lib: CardLibrary, uid: string, by: string, log: Log): void {
  if (has(state, lib, uid, "ON_RETURN_TAVERN_FLIP")) {
    log(`${faceOf(state, lib, uid).name} 回到酒館`);
    flip(state, lib, uid, by, log);
  }
}

// ── 指定與保護（docs/spec.md 13A.3）──

/**
 * source 冒險者（由 actor 控制）的能力能否指定 target。
 * 限制優先：只要有任何一個「不能」，就不能指定。
 */
export function canTarget(state: GameState, lib: CardLibrary, source: string, actor: string, target: string): boolean {
  const owner = ownerOf(state, target);
  if (!owner) return false; // 只能指定公會中的冒險者，不含酒館
  const sourceTraits = faceOf(state, lib, source).traits.map(bare);
  // 暗影【狡兔三窟】：無法被具有特定特質的冒險者能力指定
  for (const c of clauses(state, lib, target, "UNTARGETABLE_BY_TRAIT")) if (sourceTraits.includes(bare(c.x))) return false;
  if (owner.id !== actor) {
    // 梭的和弦：其他玩家的能力無法指定你公會中的冒險者
    if (owner.adventurers.some((u) => has(state, lib, u, "GUILD_UNTARGETABLE"))) return false;
    // 威利：其他玩家只能指定布魯斯與威利
    const guard = owner.adventurers.find((u) => has(state, lib, u, "REDIRECT_TARGETING"));
    if (guard && guard !== target) return false;
  }
  return true;
}

/** 你的冒險者能力中，指定冒險者的數量加成（菈的和弦）。 */
export function targetBonus(state: GameState, lib: CardLibrary, p: PlayerState): number {
  return p.adventurers.reduce((s, u) => s + clauses(state, lib, u, "TARGET_COUNT_PLUS").reduce((t, c) => t + amount(state, lib, u, c.x), 0), 0);
}

/** 隊伍中不能一起參與的組合（馬克【一朝被蛇咬】）。 */
export function participationProblem(state: GameState, lib: CardLibrary, party: readonly string[]): string | null {
  for (const uid of party) {
    for (const c of clauses(state, lib, uid, "CANNOT_PARTICIPATE_WITH")) {
      const other = party.find((u) => u !== uid && faceOf(state, lib, u).traits.some((t) => bare(t) === bare(c.x)));
      if (other) return `${faceOf(state, lib, uid).name} 無法與 ${faceOf(state, lib, other).name} 一起參與任務`;
    }
  }
  return null;
}

/** 派遣次數以「輪」計算（方庚【隨時警備】：每輪只能派遣一次）。 */
const turnId = (state: GameState) => `${state.round}`;

/** 本輪已經被派遣的次數。 */
export function dispatchesThisTurn(state: GameState, uid: string): number {
  const d = state.adventurerCards[uid]!.dispatches;
  return d && d.turn === turnId(state) ? d.count : 0;
}

/** 每輪派遣次數上限（方庚【隨時警備】）；超過時回傳提示訊息。 */
export function dispatchLimitProblem(state: GameState, lib: CardLibrary, party: readonly string[]): string | null {
  for (const uid of party) {
    for (const c of clauses(state, lib, uid, "DISPATCH_LIMIT_PER_TURN")) {
      const limit = amount(state, lib, uid, c.x);
      if (dispatchesThisTurn(state, uid) >= limit) return `${faceOf(state, lib, uid).name} 每輪只能派遣 ${limit} 次`;
    }
  }
  return null;
}

export function recordDispatch(state: GameState, party: readonly string[]): void {
  for (const uid of party) {
    const card = state.adventurerCards[uid]!;
    card.dispatches = { turn: turnId(state), count: dispatchesThisTurn(state, uid) + 1 };
  }
}

/** 每回合第一個任務必須派遣的冒險者（過勞死凱菲）。 */
export function mustDispatch(state: GameState, lib: CardLibrary, p: PlayerState): string[] {
  return p.adventurers.filter((u) => has(state, lib, u, "MUST_PARTICIPATE_FIRST") && !state.adventurerCards[u]!.tapped);
}

/** 薪資：方庚【今晚我請客】免除較低薪資的同職業同伴。回傳總薪資與被免除的人數（依免除者記錄）。 */
export function salaryFor(state: GameState, lib: CardLibrary, party: readonly string[]): { total: number; waivedBy: Record<string, number> } {
  const base = (u: string) => unitSalary(state, lib, u);
  const waived = new Set<string>();
  const waivedBy: Record<string, number> = {};
  for (const uid of party) {
    for (const c of clauses(state, lib, uid, "SALARY_WAIVE_LOWER")) {
      if (!professionMatches(state, lib, uid, c.x)) continue;
      for (const other of party) {
        if (other === uid || waived.has(other)) continue;
        if (professionMatches(state, lib, other, c.x) && base(other) < base(uid)) {
          waived.add(other);
          waivedBy[uid] = (waivedBy[uid] ?? 0) + 1;
        }
      }
    }
  }
  const total = party.filter((u) => !waived.has(u)).reduce((s, u) => s + base(u), 0);
  return { total, waivedBy };
}

export const participants = (m: Mission) => [...m.dispatched, ...m.joined];

/** 參與任務時觸發（隊伍確定、擲骰前）。 */
export function onParticipate(state: GameState, lib: CardLibrary, p: PlayerState, m: Mission, log: Log): void {
  const party = participants(m);
  const names = party.map((u) => faceOf(state, lib, u).name);
  for (const uid of party) {
    const name = faceOf(state, lib, uid).name;
    for (const c of clauses(state, lib, uid, "PARTICIPATE_GAIN")) gain(p, amount(state, lib, uid, c.x), c.y, log, name);
    for (const c of clauses(state, lib, uid, "WITH_CARD_GAIN")) {
      if (names.some((n) => sameName(n, c.x))) gain(p, amount(state, lib, uid, c.y), c.z, log, name);
    }
  }
}

/** 建立骰池：基礎骰數（含修正）加上骰數修正。 */
export function dicePool(state: GameState, lib: CardLibrary, m: Mission, def: TaskDef): number {
  const party = participants(m);
  const names = party.map((u) => faceOf(state, lib, u).name);
  const attempts = state.taskCards[m.task]!.attempts;
  let total = 0;
  for (const uid of party) {
    let base = m.baseDice[uid] ?? unitBaseDice(state, lib, uid);
    const roundDelta = state.adventurerCards[uid]!.roundBaseDelta;
    if (roundDelta?.round === state.round) base += roundDelta.delta;
    for (const c of clauses(state, lib, uid, "TASK_BASE_DICE")) if (taskMatches(c.x, def, attempts)) base += amount(state, lib, uid, c.y);
    let dice = Math.max(0, base);
    for (const c of clauses(state, lib, uid, "DICE_PER_TOKEN")) dice += amount(state, lib, uid, c.x) * amount(state, lib, uid, c.y);
    for (const c of clauses(state, lib, uid, "SQUAD_DICE")) dice += perSoldiers(state, lib, uid, c);
    for (const c of clauses(state, lib, uid, "WITH_CARD_DICE")) if (names.some((n) => sameName(n, c.x))) dice += amount(state, lib, uid, c.y);
    for (const c of clauses(state, lib, uid, "WITH_PROFESSION_DICE")) {
      if (party.some((o) => o !== uid && professionMatches(state, lib, o, c.x))) dice += amount(state, lib, uid, c.y);
    }
    total += dice;
  }
  return total;
}

/** 擲骰後的強制效果（莎莉【唉呦！】移除特定點數）。 */
export function afterRollMandatory(state: GameState, lib: CardLibrary, m: Mission, def: TaskDef, log: Log): void {
  const attempts = state.taskCards[m.task]!.attempts;
  for (const uid of participants(m)) {
    for (const c of clauses(state, lib, uid, "AFTER_ROLL_REMOVE_FACE")) {
      if (!taskMatches(c.x, def, attempts)) continue;
      const face = amount(state, lib, uid, c.y);
      const before = m.dice.length;
      m.dice = m.dice.filter((d) => d !== face);
      const removed = before - m.dice.length;
      if (removed) {
        m.removedBy[uid] = (m.removedBy[uid] ?? 0) + removed;
        log(`${faceOf(state, lib, uid).name}：移除 ${removed} 顆點數為 ${face} 的骰子`);
      }
    }
  }
}

/** 結果值修正（嗚嘎【看不懂！】）。 */
export function resultModifier(state: GameState, lib: CardLibrary, m: Mission, def: TaskDef): number {
  const attempts = state.taskCards[m.task]!.attempts;
  let mod = 0;
  for (const uid of participants(m)) {
    for (const c of clauses(state, lib, uid, "AFTER_ROLL_RESULT_MOD")) if (taskMatches(c.x, def, attempts)) mod += amount(state, lib, uid, c.y);
  }
  return mod;
}

/** 難度調整：嘗試指示物，加上參與者的能力。 */
export function difficulty(state: GameState, lib: CardLibrary, m: Mission, def: TaskDef): number {
  const party = participants(m);
  const names = party.map((u) => faceOf(state, lib, u).name);
  const attempts = state.taskCards[m.task]!.attempts;
  let n = attempts;
  for (const uid of party) {
    for (const c of clauses(state, lib, uid, "TASK_DIFFICULTY")) if (taskMatches(c.x, def, attempts)) n += amount(state, lib, uid, c.y);
    for (const c of clauses(state, lib, uid, "WITH_CARD_DIFFICULTY")) if (names.some((x) => sameName(x, c.x))) n += amount(state, lib, uid, c.y);
    for (const c of clauses(state, lib, uid, "SQUAD_DIFFICULTY")) n += perSoldiers(state, lib, uid, c);
  }
  return Math.max(0, n);
}

/** 任務結算時觸發（成功與失敗都會結算）。 */
export function onSettle(
  state: GameState,
  lib: CardLibrary,
  p: PlayerState,
  m: Mission,
  def: TaskDef,
  ctx: { success: boolean; faceSum: number; slot: number | null; emptyBefore: Set<number>; waivedBy: Record<string, number> },
  log: Log,
): void {
  const attempts = state.taskCards[m.task]!.attempts;
  const party = participants(m);
  for (const uid of party) {
    const name = faceOf(state, lib, uid).name;
    if (ctx.success) {
      for (const c of clauses(state, lib, uid, "COMPLETE_GAIN")) if (taskMatches(c.x, def, attempts)) gain(p, amount(state, lib, uid, c.y), c.z, log, name);
      for (const c of clauses(state, lib, uid, "SQUAD_COMPLETE_GAIN")) gain(p, perSoldiers(state, lib, uid, c), c.z, log, `${name}（隊長）`);
      for (const c of clauses(state, lib, uid, "COMPLETE_GAIN_ITEM")) {
        const options = splitList(c.y).filter((n) => lib.items.has(n));
        if (taskMatches(c.x, def, attempts) && options.length) pushPending(state, { kind: "chooseItem", player: p.id, options, optional: true, source: uid });
      }
    }
    for (const c of clauses(state, lib, uid, "SETTLE_PARITY_GAIN")) {
      const even = ctx.faceSum % 2 === 0;
      if ((c.x === "偶數") === even) gain(p, amount(state, lib, uid, c.y), c.z, log, name);
    }
    for (const c of clauses(state, lib, uid, "SETTLE_GAIN")) gain(p, amount(state, lib, uid, c.x), c.y, log, name);
    for (const c of clauses(state, lib, uid, "PER_REMOVED_DIE_GAIN")) gain(p, (m.removedBy[uid] ?? 0) * amount(state, lib, uid, c.x), c.y, log, name);
    for (const c of clauses(state, lib, uid, "TAP_SELF_IF_WAIVED")) {
      if ((ctx.waivedBy[uid] ?? 0) >= amount(state, lib, uid, c.x)) {
        state.adventurerCards[uid]!.tapped = true;
        log(`${name} 免除了 ${ctx.waivedBy[uid]} 名冒險者的薪資，橫置`);
      }
    }
  }
  // 薩姆【野火蔓延】：任何玩家完成特定標籤的任務時，擁有者可以選擇獲得道具
  if (ctx.success) {
    for (const owner of state.players) {
      for (const uid of owner.adventurers) {
        for (const c of clauses(state, lib, uid, "ON_ANY_COMPLETE_TAG_ITEM")) {
          const tags = splitList(c.x);
          const options = splitList(c.y).filter((n) => lib.items.has(n));
          if (tags.some((t) => taskMatches(t, def, attempts)) && options.length) {
            pushPending(state, { kind: "chooseItem", player: owner.id, options, optional: true, source: uid });
          }
        }
      }
    }
  }
  // 公會中的冒險者（不一定參與）
  for (const uid of p.adventurers) {
    const name = faceOf(state, lib, uid).name;
    for (const c of clauses(state, lib, uid, "SETTLE_IF_TAPPED_GAIN")) {
      if (state.adventurerCards[uid]!.tapped) gain(p, amount(state, lib, uid, c.x), c.y, log, name);
    }
    if (ctx.success) {
      for (const c of clauses(state, lib, uid, "COMPLETE_IN_SLOT_GAIN")) {
        if (ctx.slot === Number(c.x) && ctx.emptyBefore.has(Number(c.y))) gain(p, amount(state, lib, uid, c.z), "金幣", log, name);
      }
    }
  }
}

// ── 回合結束與輪末 ──

export function onTurnEnd(state: GameState, lib: CardLibrary, p: PlayerState, log: Log): void {
  // 比爾、凱莉：回合結束時獲得道具（先判斷直立條件，再處理會橫置的效果）
  for (const uid of p.adventurers) {
    const upright = !state.adventurerCards[uid]!.tapped;
    for (const c of clauses(state, lib, uid, "TURNEND_GAIN_ITEM")) {
      if (c.x.includes("直立") && !upright) continue;
      for (let i = 0; i < amount(state, lib, uid, c.y); i++) gainItem(state, lib, p, c.z, log);
    }
  }
  for (const uid of p.adventurers) {
    const card = state.adventurerCards[uid]!;
    for (const c of clauses(state, lib, uid, "TURNEND_IF_UPRIGHT_TAP_PAY")) {
      if (card.tapped) continue;
      card.tapped = true;
      const pay = Math.min(p.gold, amount(state, lib, uid, c.x)); // 強制支付，金幣不足時扣到 0
      p.gold -= pay;
      log(`${faceOf(state, lib, uid).name} 回合結束時直立：橫置並支付 ${pay} 金`);
    }
  }
}

/** 輪末結算第 1 步：輪末效果。 */
export function onRoundEnd(state: GameState, lib: CardLibrary, log: (player: PlayerState, text: string) => void): void {
  for (const p of state.players) {
    for (const uid of p.adventurers) {
      const card = state.adventurerCards[uid]!;
      const name = faceOf(state, lib, uid).name;
      for (const c of clauses(state, lib, uid, "ROUNDEND_IF_TAPPED_GAIN")) {
        if (card.tapped) gain(p, amount(state, lib, uid, c.x), c.y, (t) => log(p, t), name);
      }
      for (const c of clauses(state, lib, uid, "ROUNDEND_IF_UPRIGHT_TOKEN")) {
        if (!card.tapped) addTokens(state, lib, uid, c.y, amount(state, lib, uid, c.x), (t) => log(p, t));
      }
    }
  }
}

/** 輪末結算第 2 步：是否重置。 */
export function resetsAtRoundEnd(state: GameState, lib: CardLibrary, uid: string): boolean {
  if (state.adventurerCards[uid]!.noResetRound === state.round) return false;
  return !has(state, lib, uid, "NO_ROUND_RESET");
}

// ── M3-2：擲骰前的選擇 ──

export interface RollChoices {
  /** 怪盜雞德【犯罪預告】：uid → 預言結果值為奇數或偶數。 */
  readonly predictions?: Readonly<Record<string, "odd" | "even">>;
  /** 古斯【你跑不掉的】：uid → 本次的基礎骰數。 */
  readonly baseDice?: Readonly<Record<string, number>>;
}

/** 套用擲骰前的選擇，並檢查必要的選擇是否都已提供。 */
export function applyRollChoices(state: GameState, lib: CardLibrary, m: Mission, choices: RollChoices): void {
  const party = participants(m);
  for (const uid of party) {
    const name = faceOf(state, lib, uid).name;
    if (has(state, lib, uid, "PREDICT_PARITY")) {
      const p = choices.predictions?.[uid];
      if (p !== "odd" && p !== "even") throw new RuleError(`${name} 需要在擲骰前預言結果值為奇數或偶數`);
      m.predictions[uid] = p;
    }
    const range = clauses(state, lib, uid, "BASE_DICE_CHOICE")[0];
    const chosen = choices.baseDice?.[uid];
    if (chosen !== undefined) {
      if (!range) throw new RuleError(`${name} 不能自選基礎骰數`);
      const lo = amount(state, lib, uid, range.x);
      const hi = amount(state, lib, uid, range.y);
      if (!Number.isInteger(chosen) || chosen < lo || chosen > hi) throw new RuleError(`${name} 的基礎骰數只能是 ${lo}～${hi}`);
      m.baseDice[uid] = chosen;
    }
  }
}

// ── M3-2：擲骰後的調整 ──

export type Adjustment =
  /** 瓦雷諾【老兵】：重擲指定的骰子（骰子編號，0 起算）。 */
  | { readonly kind: "reroll"; readonly card: string; readonly dice: readonly number[] }
  /** 羅德教授、阿絲特拉、凱莉：把一顆骰子轉到相鄰的面。 */
  | { readonly kind: "turn"; readonly card: string; readonly die: number; readonly face: number }
  /** 阿特薩【這命運是無法改變的！】：移除一顆骰子（強制）。 */
  | { readonly kind: "remove"; readonly card: string; readonly die: number }
  /** 馬文【加注】：重擲點數最大（至少 X）或最小（至多 X）的 count 顆骰子。 */
  | { readonly kind: "gamble"; readonly card: string; readonly count: number }
  /** 喀嘣小嗶：結果值調整 delta。 */
  | { readonly kind: "adjustResult"; readonly card: string; readonly delta: number }
  /** 兜的和弦：消耗道具，使本次任務視為成功。 */
  | { readonly kind: "autoSuccess"; readonly card: string };

const ADJUST_CODE: Record<Adjustment["kind"], string> = {
  reroll: "AFTER_ROLL_REROLL",
  turn: "AFTER_ROLL_TURN",
  remove: "AFTER_ROLL_REMOVE_DICE",
  gamble: "GAMBLE_REROLL",
  adjustResult: "RESULT_ADJUST",
  autoSuccess: "AFTER_ROLL_AUTO_SUCCESS",
};

export interface AdjustOption {
  readonly card: string;
  readonly kind: Adjustment["kind"];
  /** 還可以使用的量：重擲／轉動／移除的骰子數，或結果值調整的上限。 */
  readonly remaining: number;
  readonly mandatory: boolean;
}

const useKey = (uid: string, code: string) => `${uid}:${code}`;

/** 目前可以使用的擲骰後能力。 */
export function adjustOptions(state: GameState, lib: CardLibrary, m: Mission): AdjustOption[] {
  if (m.stage !== "adjust") return [];
  const def = lib.task(state.taskCards[m.task]!.defKey);
  const attempts = state.taskCards[m.task]!.attempts;
  const out: AdjustOption[] = [];
  for (const uid of participants(m)) {
    const used = (code: string) => m.used[useKey(uid, code)] ?? 0;
    for (const c of clauses(state, lib, uid, "AFTER_ROLL_REROLL")) {
      if (taskMatches(c.x, def, attempts) && !used(c.code)) out.push({ card: uid, kind: "reroll", remaining: amount(state, lib, uid, c.y), mandatory: false });
    }
    for (const c of clauses(state, lib, uid, "AFTER_ROLL_TURN")) {
      const left = amount(state, lib, uid, c.y) - (m.turned[uid]?.length ?? 0);
      if (taskMatches(c.x, def, attempts) && left > 0) out.push({ card: uid, kind: "turn", remaining: left, mandatory: false });
    }
    for (const c of clauses(state, lib, uid, "AFTER_ROLL_REMOVE_DICE")) {
      const left = Math.min(amount(state, lib, uid, c.x) - used(c.code), m.dice.length);
      if (left > 0) out.push({ card: uid, kind: "remove", remaining: left, mandatory: true });
    }
    for (const c of clauses(state, lib, uid, "GAMBLE_REROLL")) {
      if (!used(c.code) && def.condition && def.condition.op !== "between") {
        out.push({ card: uid, kind: "gamble", remaining: Math.min(amount(state, lib, uid, c.y), m.dice.length), mandatory: false });
      }
    }
    for (const c of clauses(state, lib, uid, "RESULT_ADJUST")) {
      if (!used(c.code)) out.push({ card: uid, kind: "adjustResult", remaining: amount(state, lib, uid, c.x), mandatory: false });
    }
    for (const c of clauses(state, lib, uid, "SQUAD_RESULT_ADJUST")) {
      const n = perSoldiers(state, lib, uid, c);
      if (!used("RESULT_ADJUST") && n > 0) out.push({ card: uid, kind: "adjustResult", remaining: n, mandatory: false });
    }
  }
  // 兜的和弦：每次你派遣冒險者執行任務時（公會中的能力，不需參與）
  const owner = state.players.find((p) => p.adventurers.includes(m.dispatched[0] ?? ""));
  for (const uid of owner?.adventurers ?? []) {
    for (const c of clauses(state, lib, uid, "AFTER_ROLL_AUTO_SUCCESS")) {
      if (!m.autoSuccess && countCategory(state, lib, owner!, c.y) >= amount(state, lib, uid, c.x)) {
        out.push({ card: uid, kind: "autoSuccess", remaining: 1, mandatory: false });
      }
    }
  }
  return out;
}

export function applyAdjustment(state: GameState, lib: CardLibrary, rng: Rng, m: Mission, adj: Adjustment, log: (text: string, dice?: number[]) => void): void {
  const option = adjustOptions(state, lib, m).find((o) => o.card === adj.card && o.kind === adj.kind);
  const name = faceOf(state, lib, adj.card).name;
  if (!option) throw new RuleError(`${name} 現在不能使用這個能力`);
  const code = ADJUST_CODE[adj.kind];
  const clause = clauses(state, lib, adj.card, code)[0] ?? clauses(state, lib, adj.card, "SQUAD_RESULT_ADJUST")[0]!;
  const key = useKey(adj.card, code);
  const checkDie = (i: number) => {
    if (!Number.isInteger(i) || i < 0 || i >= m.dice.length) throw new RuleError("沒有這顆骰子");
  };
  switch (adj.kind) {
    case "reroll": {
      if (!adj.dice.length || adj.dice.length > option.remaining) throw new RuleError(`最多重擲 ${option.remaining} 顆骰子`);
      if (new Set(adj.dice).size !== adj.dice.length) throw new RuleError("同一顆骰子不能重擲兩次");
      adj.dice.forEach(checkDie);
      for (const i of adj.dice) m.dice[i] = rng.d6();
      m.used[key] = 1;
      log(`${name}：重擲 ${adj.dice.length} 顆骰子`, [...m.dice]);
      break;
    }
    case "turn": {
      checkDie(adj.die);
      if ((m.turned[adj.card] ?? []).includes(adj.die)) throw new RuleError("每顆骰子只能轉動 1 次");
      const from = m.dice[adj.die]!;
      if (!turnOptions(from).includes(adj.face)) throw new RuleError(`點數 ${from} 只能轉成 ${turnOptions(from).join("、")}`);
      m.dice[adj.die] = adj.face;
      m.turned[adj.card] = [...(m.turned[adj.card] ?? []), adj.die];
      log(`${name}：把 ${from} 轉成 ${adj.face}`, [...m.dice]);
      break;
    }
    case "remove": {
      checkDie(adj.die);
      const [face] = m.dice.splice(adj.die, 1);
      m.used[key] = (m.used[key] ?? 0) + 1;
      m.removedBy[adj.card] = (m.removedBy[adj.card] ?? 0) + 1;
      log(`${name}：移除一顆點數 ${face} 的骰子`, [...m.dice]);
      break;
    }
    case "gamble": {
      const lo = amount(state, lib, adj.card, clause.x);
      if (!Number.isInteger(adj.count) || adj.count < lo || adj.count > option.remaining) throw new RuleError(`加注只能重擲 ${lo}～${option.remaining} 顆骰子`);
      const def = lib.task(state.taskCards[m.task]!.defKey);
      const successBefore = outcome(state, lib, m).success;
      // 至少 X：重擲點數最大的；至多 X：重擲點數最小的
      const order = m.dice.map((d, i) => ({ d, i })).sort((a, b) => (def.condition!.op === "atLeast" ? b.d - a.d : a.d - b.d));
      for (const { i } of order.slice(0, adj.count)) m.dice[i] = rng.d6();
      m.used[key] = 1;
      m.gamble = { uid: adj.card, count: adj.count, successBefore };
      log(`${name}【加注】：重擲 ${adj.count} 顆骰子`, [...m.dice]);
      break;
    }
    case "adjustResult": {
      if (!Number.isInteger(adj.delta) || Math.abs(adj.delta) > option.remaining) throw new RuleError(`結果值最多調整 ±${option.remaining}`);
      m.resultDelta += adj.delta;
      m.used[key] = 1;
      log(`${name}：結果值 ${adj.delta >= 0 ? "+" : ""}${adj.delta}`);
      break;
    }
    case "autoSuccess": {
      const owner = ownerOf(state, adj.card)!;
      consumeCategory(state, lib, owner, amount(state, lib, adj.card, clause.x), clause.y, log);
      m.autoSuccess = true;
      log(`${name}：本次任務視為成功`);
      break;
    }
  }
}

/** 強制的擲骰後能力還沒處理完時，回傳提示訊息。 */
export function pendingMandatory(state: GameState, lib: CardLibrary, m: Mission): string | null {
  const o = adjustOptions(state, lib, m).find((x) => x.mandatory);
  return o ? `${faceOf(state, lib, o.card).name} 必須先移除 ${o.remaining} 顆骰子` : null;
}

/** 目前的結果值、難度調整與成敗。 */
export function outcome(state: GameState, lib: CardLibrary, m: Mission): { faceSum: number; result: number; n: number; success: boolean } {
  const def = lib.task(state.taskCards[m.task]!.defKey);
  const c = def.condition!;
  const faceSum = m.dice.reduce((a, b) => a + b, 0);
  const result = (faceSum + resultModifier(state, lib, m, def) + m.resultDelta) * m.resultTimes;
  const n = difficulty(state, lib, m, def);
  // 區間條件由玩家分配難度調整到兩端，等同於結果落在 [X−n, Y+n] 內即可
  const success =
    m.autoSuccess ||
    (c.op === "atLeast" ? result >= c.x - n : c.op === "atMost" ? result <= c.x + n : result >= c.x - n && result <= c.y + n);
  return { faceSum, result, n, success };
}

/** 送錯的軍令：派遣具有特定特質的冒險者參與時，可直接完成此任務（不擲骰）。 */
export function completesDirectly(state: GameState, lib: CardLibrary, m: Mission): boolean {
  const def = lib.task(state.taskCards[m.task]!.defKey);
  return lib.clauses(def).some(
    (t) => t.code === "TASK_AUTO_COMPLETE_TRAIT" && m.dispatched.some((u) => faceOf(state, lib, u).traits.some((x) => bare(x) === bare(t.x))),
  );
}

/** 預言與加注的結算。 */
export function onSettleChoices(state: GameState, lib: CardLibrary, p: PlayerState, m: Mission, result: number, success: boolean, log: Log): void {
  for (const [uid, guess] of Object.entries(m.predictions)) {
    const name = faceOf(state, lib, uid).name;
    const actual = Math.abs(result) % 2 === 0 ? "even" : "odd";
    for (const c of clauses(state, lib, uid, "PREDICT_PARITY")) {
      if (guess === actual) gain(p, amount(state, lib, uid, c.x), c.y, log, `${name} 預言正確`);
      else log(`${name} 預言錯誤`);
    }
  }
  if (m.gamble && success && m.gamble.successBefore) {
    const c = clauses(state, lib, m.gamble.uid, "GAMBLE_REROLL")[0];
    if (c) gain(p, m.gamble.count * amount(state, lib, m.gamble.uid, c.z), "金幣", log, `${faceOf(state, lib, m.gamble.uid).name}【加注】成功`);
  }
}

/** 暴走小嗶【嗶！（跑！）】：和指定的冒險者在同一個公會時，洗回冒險者牌庫。 */
export function shuffleBackCheck(state: GameState, lib: CardLibrary, rng: Rng, log: (player: string, text: string) => void): void {
  for (const p of state.players) {
    for (const uid of [...p.adventurers]) {
      for (const c of clauses(state, lib, uid, "SHUFFLE_BACK_WITH")) {
        if (!p.adventurers.some((u) => u !== uid && sameName(faceOf(state, lib, u).name, c.x))) continue;
        p.adventurers = p.adventurers.filter((u) => u !== uid);
        const card = state.adventurerCards[uid]!;
        card.tapped = false;
        card.tokens = {};
        const pos = rng.int(0, state.adventurerDeck.length);
        state.adventurerDeck.splice(pos, 0, uid);
        log(p.id, `${faceOf(state, lib, uid).name} 和 ${c.x} 在同一個公會，被洗回冒險者牌庫`);
      }
    }
  }
}

/** 菲特【如果當時……】：輪末把被暫時翻面的卡翻回來，菲特移回原位。 */
export function endTemporaryFlips(state: GameState, lib: CardLibrary, log: (player: string, text: string) => void): void {
  for (const p of state.players) {
    for (const fate of p.adventurers) {
      const card = state.adventurerCards[fate]!;
      if (!card.under) continue;
      const target = card.under;
      delete card.under;
      const t = state.adventurerCards[target];
      if (!t) continue;
      delete t.flipLock;
      log(p.id, `${faceOf(state, lib, fate).name} 移回原位`);
      flip(state, lib, target, p.id, (x) => log(p.id, x));
    }
  }
}
