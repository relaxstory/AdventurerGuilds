/**
 * 卡片能力：依技能子句（docs/skill-templates.md）查詢修正值、觸發效果。
 *
 * 每個子句對應一個技能模板。常駐效果以「查詢」方式計算（例如難度調整），
 * 觸發效果在規則流程的固定時機呼叫（例如任務結算時）。
 */
import type { ClauseDef, CardLibrary, TaskDef } from "./defs.js";
import type { GameState, Mission, PlayerState } from "./state.js";

/** 已實作的技能模板。其餘模板在對應的開發批次完成（docs/development.md）。 */
export const IMPLEMENTED = new Set([
  "COND_HAS_CARDS",
  "NO_ROUND_RESET", "NO_TAP_FIRST_DISPATCH", "NO_TAP_DISPATCH", "DISPATCH_ADD_TOKEN_NO_TAP",
  "DICE_PER_TOKEN", "TOKEN_THRESHOLD_FLIP", "CANNOT_BE_FIRED", "NOT_COUNT_CAPACITY",
  "CANNOT_PARTICIPATE_WITH", "COUNTS_AS_RACE", "ANY_PROFESSION", "FREE_RECRUIT_IF_NAME", "MUST_PARTICIPATE_FIRST",
  "TASK_DIFFICULTY", "WITH_CARD_DIFFICULTY", "WITH_PROFESSION_DICE", "WITH_CARD_DICE", "TASK_BASE_DICE",
  "AFTER_ROLL_RESULT_MOD", "AFTER_ROLL_REMOVE_FACE", "PER_REMOVED_DIE_GAIN",
  "PARTICIPATE_GAIN", "WITH_CARD_GAIN", "COMPLETE_GAIN", "SETTLE_PARITY_GAIN", "SETTLE_IF_TAPPED_GAIN", "SETTLE_GAIN",
  "COMPLETE_IN_SLOT_GAIN", "SALARY_WAIVE_LOWER", "TAP_SELF_IF_WAIVED",
  "ROUNDEND_IF_TAPPED_GAIN", "ROUNDEND_IF_UPRIGHT_TOKEN", "TURNEND_IF_UPRIGHT_TAP_PAY", "ON_RECRUIT_GAIN",
]);

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
  return p.adventurers.filter((u) => !has(state, lib, u, "NOT_COUNT_CAPACITY")).length;
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
  if (has(state, lib, uid, "NO_TAP_FIRST_DISPATCH") && card.freeDispatchRound !== state.round) {
    card.freeDispatchRound = state.round;
    log(`${name} 本輪第一次派遣，不需橫置`);
    return false;
  }
  return true;
}

export function addTokens(state: GameState, lib: CardLibrary, uid: string, token: string, n: number, log: Log): void {
  const card = state.adventurerCards[uid]!;
  card.tokens[token] = (card.tokens[token] ?? 0) + n;
  const name = faceOf(state, lib, uid).name;
  log(`${name} 放置 ${n} 個${token}指示物（共 ${card.tokens[token]} 個）`);
  for (const c of clauses(state, lib, uid, "TOKEN_THRESHOLD_FLIP")) {
    if (c.x === token && card.tokens[token]! >= amount(state, lib, uid, c.y)) {
      card.tapped = true;
      card.face = card.face === "front" ? "back" : "front";
      delete card.tokens[token];
      log(`${name} 的${token}指示物達到 ${c.y} 個：橫置並翻面為 ${faceOf(state, lib, uid).name}`);
    }
  }
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

/** 每回合第一個任務必須派遣的冒險者（過勞死凱菲）。 */
export function mustDispatch(state: GameState, lib: CardLibrary, p: PlayerState): string[] {
  return p.adventurers.filter((u) => has(state, lib, u, "MUST_PARTICIPATE_FIRST") && !state.adventurerCards[u]!.tapped);
}

/** 薪資：方庚【今晚我請客】免除較低薪資的同職業同伴。回傳總薪資與被免除的人數（依免除者記錄）。 */
export function salaryFor(state: GameState, lib: CardLibrary, party: readonly string[]): { total: number; waivedBy: Record<string, number> } {
  const base = (u: string) => Math.max(0, faceOf(state, lib, u).salary ?? 0);
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
    let base = Math.max(0, faceOf(state, lib, uid).baseDice ?? 0);
    for (const c of clauses(state, lib, uid, "TASK_BASE_DICE")) if (taskMatches(c.x, def, attempts)) base += amount(state, lib, uid, c.y);
    let dice = Math.max(0, base);
    for (const c of clauses(state, lib, uid, "DICE_PER_TOKEN")) dice += amount(state, lib, uid, c.x) * amount(state, lib, uid, c.y);
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
  return !has(state, lib, uid, "NO_ROUND_RESET");
}
