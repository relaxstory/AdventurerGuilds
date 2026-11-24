import { RULES } from "./constants.js";
import type { CardLibrary, TaskDef } from "./defs.js";
import { RuleError } from "./errors.js";
import { scoreGame } from "./honors.js";
import { Rng } from "./rng.js";
import { currentPlayer, currentPlayerIndex, type GameState, type PlayerState } from "./state.js";

export type ExpiryPenalty = "gold" | "reputation";

export type Action =
  /** 公會階段：招募酒館第 tavernIndex 張（0 起算）；replace 為要解僱的冒險者。 */
  | { readonly type: "recruit"; readonly tavernIndex: number; readonly replace?: string }
  /** 公會階段：接取公告欄第 boardIndex 張任務。 */
  | { readonly type: "acceptTask"; readonly boardIndex: number }
  | { readonly type: "endGuildPhase" }
  /** 冒險階段：派遣冒險者執行任務。 */
  | { readonly type: "dispatch"; readonly task: string; readonly adventurers: readonly string[] }
  | { readonly type: "endAdventurePhase" }
  /** 公會整理階段：逾期懲罰金幣與聲望都能付時，由玩家選擇。 */
  | { readonly type: "choosePenalty"; readonly task: string; readonly penalty: ExpiryPenalty }
  /** 公會整理階段：升級公會。 */
  | { readonly type: "upgrade" }
  /** 公會整理階段：結束回合。 */
  | { readonly type: "endTurn" };

// ── 查詢 ──

export function stagingSlots(p: PlayerState): number {
  return p.upgraded ? RULES.stagingSlots.upgraded : RULES.stagingSlots.base;
}

export function upgradeCost(p: PlayerState): number {
  if (p.completed.length >= RULES.upgrade.freeAtCompleted) return 0;
  if (Math.abs(p.reputation) >= RULES.upgrade.discountReputation) return RULES.upgrade.discountCost;
  return RULES.upgrade.cost;
}

/** 冒險者目前朝上那一面的定義。 */
export function adventurerFace(state: GameState, lib: CardLibrary, uid: string) {
  const card = state.adventurerCards[uid];
  if (!card) throw new Error(`找不到冒險者 ${uid}`);
  const id = card.face === "back" ? `${card.defId}B` : card.defId;
  return lib.adventurer(id);
}

export function salaryOf(state: GameState, lib: CardLibrary, uid: string): number {
  return Math.max(0, adventurerFace(state, lib, uid).salary ?? 0);
}

export function baseDiceOf(state: GameState, lib: CardLibrary, uid: string): number {
  return Math.max(0, adventurerFace(state, lib, uid).baseDice ?? 0);
}

export function taskDef(state: GameState, lib: CardLibrary, uid: string): TaskDef {
  const card = state.taskCards[uid];
  if (!card) throw new Error(`找不到任務 ${uid}`);
  return lib.task(card.defKey);
}

// ── 套用操作 ──

/** 套用一個操作，回傳新的遊戲狀態（不改動原狀態）。不合法的操作拋出 RuleError。 */
export function applyAction(prev: GameState, action: Action, lib: CardLibrary): GameState {
  if (prev.phase === "gameOver") throw new RuleError("遊戲已經結束");
  const state = structuredClone(prev);
  const rng = Rng.restore(state.rng);
  const p = currentPlayer(state);
  const log = (text: string, dice?: number[]) => state.log.push({ round: state.round, player: p.id, text, ...(dice ? { dice } : {}) });
  const need = (phase: GameState["phase"], label: string) => {
    if (state.phase !== phase) throw new RuleError(`現在不是${label}`);
  };

  switch (action.type) {
    case "recruit": {
      need("guild", "公會階段");
      if (p.actionsLeft < 1) throw new RuleError("本回合的公會行動已經用完");
      const uid = state.tavern[action.tavernIndex];
      if (!uid) throw new RuleError("酒館的這個位置沒有冒險者");
      const name = adventurerFace(state, lib, uid).name;
      if (action.replace !== undefined) {
        const i = p.adventurers.indexOf(action.replace);
        if (i < 0) throw new RuleError("只能解僱自己公會中的冒險者");
        const fired = action.replace;
        p.adventurers.splice(i, 1);
        state.adventurerCards[fired]!.tapped = false;
        // 被解僱的冒險者放進被招募者原本的位置，不從牌庫補牌（docs/spec.md 6.2）
        state.tavern[action.tavernIndex] = fired;
        log(`招募 ${name}，解僱 ${adventurerFace(state, lib, fired).name}`);
      } else {
        if (p.adventurers.length >= RULES.adventurerCapacity) {
          throw new RuleError(`冒險者已達上限 ${RULES.adventurerCapacity} 名，請選擇要解僱的冒險者`);
        }
        // 後面的冒險者依序往前補，從牌庫翻開新冒險者放到末端
        state.tavern.splice(action.tavernIndex, 1);
        const next = state.adventurerDeck.shift();
        if (next) state.tavern.push(next);
        log(`招募 ${name}`);
      }
      p.adventurers.push(uid);
      p.actionsLeft -= 1;
      break;
    }

    case "acceptTask": {
      need("guild", "公會階段");
      if (p.actionsLeft < 1) throw new RuleError("本回合的公會行動已經用完");
      if (p.staging.length >= stagingSlots(p)) throw new RuleError("任務暫存格已滿");
      const uid = state.board[action.boardIndex];
      if (!uid) throw new RuleError("公告欄的這個位置沒有任務");
      state.board[action.boardIndex] = null; // 空位在輪末才補
      p.staging.push(uid);
      p.actionsLeft -= 1;
      log(`接取任務「${taskDef(state, lib, uid).name}」`);
      break;
    }

    case "endGuildPhase":
      need("guild", "公會階段");
      state.phase = "adventure";
      break;

    case "dispatch": {
      need("adventure", "冒險階段");
      dispatch(state, lib, rng, p, action.task, action.adventurers, log);
      break;
    }

    case "endAdventurePhase": {
      need("adventure", "冒險階段");
      state.phase = "cleanup";
      // 1. 正式任務區原有任務的時限 −1，找出逾期的任務
      for (const f of p.formal) {
        if (f.timer === null) continue;
        f.timer -= 1;
        if (f.timer <= 0) state.pendingExpiry.push(f.uid);
      }
      resolveExpiries(state, lib, p, log);
      break;
    }

    case "choosePenalty": {
      need("cleanup", "公會整理階段");
      if (state.pendingExpiry[0] !== action.task) throw new RuleError("這個任務目前不需要選擇逾期懲罰");
      resolveExpiries(state, lib, p, log, action.penalty);
      break;
    }

    case "upgrade": {
      need("cleanup", "公會整理階段");
      requireExpiriesResolved(state, lib);
      if (p.upgraded) throw new RuleError("公會已經升級過了");
      const cost = upgradeCost(p);
      if (p.gold < cost) throw new RuleError(`金幣不足：升級需要 ${cost} 金`);
      p.gold -= cost;
      p.upgraded = true;
      log(cost === 0 ? "完成 4 項任務，免費升級公會" : `花費 ${cost} 金升級公會`);
      break;
    }

    case "endTurn": {
      need("cleanup", "公會整理階段");
      requireExpiriesResolved(state, lib);
      endTurn(state, lib, rng);
      break;
    }
  }

  state.rng = rng.snapshot();
  return state;
}

// ── 冒險階段：派遣 ──

function dispatch(
  state: GameState,
  lib: CardLibrary,
  rng: Rng,
  p: PlayerState,
  taskUid: string,
  party: readonly string[],
  log: (text: string, dice?: number[]) => void,
): void {
  const inStaging = p.staging.includes(taskUid);
  const inFormal = p.formal.some((f) => f.uid === taskUid);
  if (!inStaging && !inFormal) throw new RuleError("只能執行自己暫存格或正式任務區的任務");
  const def = taskDef(state, lib, taskUid);
  if (!def.condition) throw new RuleError(`任務「${def.name}」沒有任務目標，無法執行`);
  if (def.type === "史詩" && state.epicTried.includes(taskUid)) throw new RuleError("史詩任務只能嘗試一次");
  if (party.length === 0) throw new RuleError("至少要派遣 1 名冒險者");
  if (new Set(party).size !== party.length) throw new RuleError("同一名冒險者不能重複派遣");
  for (const uid of party) {
    if (!p.adventurers.includes(uid)) throw new RuleError("只能派遣自己公會中的冒險者");
    if (state.adventurerCards[uid]!.tapped) throw new RuleError(`${adventurerFace(state, lib, uid).name} 已經橫置，不能派遣`);
  }

  // 擲骰前支付薪資（docs/spec.md 7.1）
  const salary = party.reduce((s, uid) => s + salaryOf(state, lib, uid), 0);
  if (p.gold < salary) throw new RuleError(`金幣不足：薪資需要 ${salary} 金，目前只有 ${p.gold} 金`);
  p.gold -= salary;
  for (const uid of party) state.adventurerCards[uid]!.tapped = true;

  const dice = rng.rollDice(party.reduce((s, uid) => s + baseDiceOf(state, lib, uid), 0));
  const result = dice.reduce((a, b) => a + b, 0);
  const card = state.taskCards[taskUid]!;
  const n = card.attempts; // 每枚嘗試指示物＝難度調整 1
  const c = def.condition;
  // 區間條件由玩家分配難度調整到兩端，等同於結果落在 [X−n, Y+n] 內即可
  const success =
    c.op === "atLeast" ? result >= c.x - n : c.op === "atMost" ? result <= c.x + n : result >= c.x - n && result <= c.y + n;
  const names = party.map((uid) => adventurerFace(state, lib, uid).name).join("、");
  const isEpic = def.type === "史詩";
  if (isEpic) state.epicTried.push(taskUid);

  if (success) {
    const penalty = RULES.distrust.goldPenalty[Math.min(p.distrust, RULES.distrust.max)] ?? 0;
    const gold = Math.max(0, (def.gold ?? 0) - penalty);
    p.gold += gold;
    p.reputation += def.reputation ?? 0;
    if (p.distrust > 0) p.distrust -= 1; // 先用目前層數扣報酬，再消除 1 層
    card.attempts = 0;
    if (def.type === "永久") {
      card.completions += 1; // 永久任務留在 [∞]，可以重複完成（docs/spec.md 7.6）
    } else {
      removeTask(p, taskUid);
      p.completed.push(taskUid);
    }
    log(`派遣 ${names} 執行「${def.name}」，支付薪資 ${salary} 金，擲出 ${result}：成功，獲得 ${gold} 金、聲望 ${signed(def.reputation ?? 0)}`, dice);
  } else if (isEpic) {
    // 史詩任務失敗：翻面結算背面效果（M3），不獲得正面獎勵
    removeTask(p, taskUid);
    state.taskDiscard.push(taskUid);
    log(`派遣 ${names} 執行史詩任務「${def.name}」，支付薪資 ${salary} 金，擲出 ${result}：失敗`, dice);
  } else {
    card.attempts += 1;
    log(`派遣 ${names} 執行「${def.name}」，支付薪資 ${salary} 金，擲出 ${result}：失敗，獲得嘗試指示物（共 ${card.attempts} 枚）`, dice);
  }
}

function removeTask(p: PlayerState, uid: string): void {
  p.staging = p.staging.filter((u) => u !== uid);
  p.formal = p.formal.filter((f) => f.uid !== uid);
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

// ── 公會整理階段 ──

/** 逾期懲罰可以執行的方式（docs/spec.md 8.2）。 */
export function penaltyOptions(p: PlayerState, def: TaskDef): { goldAmount: number; gold: boolean; reputation: boolean } {
  const goldAmount = Math.floor((def.gold ?? 0) / 2);
  return { goldAmount, gold: p.gold >= goldAmount, reputation: p.reputation !== 0 };
}

function requireExpiriesResolved(state: GameState, lib: CardLibrary): void {
  const uid = state.pendingExpiry[0];
  if (uid) throw new RuleError(`請先選擇任務「${taskDef(state, lib, uid).name}」的逾期懲罰`);
}

/**
 * 2. 依序處理逾期任務。遇到金幣與聲望都能付、需要玩家選擇的任務時停下來；
 * 全部處理完後，3. 暫存格的任務依類型移入正式任務區。
 */
function resolveExpiries(state: GameState, lib: CardLibrary, p: PlayerState, log: (text: string) => void, choice?: ExpiryPenalty): void {
  while (state.pendingExpiry.length) {
    const uid = state.pendingExpiry[0]!;
    const def = taskDef(state, lib, uid);
    if (def.type === "史詩") {
      state.epicTried.push(uid); // 史詩任務逾期視為失敗（M3 結算背面效果）
      log(`史詩任務「${def.name}」逾期，視為失敗`);
    } else {
      const opt = penaltyOptions(p, def);
      let pick: ExpiryPenalty | "none";
      if (opt.gold && opt.reputation) {
        if (!choice) return; // 等待玩家選擇
        pick = choice;
        choice = undefined;
      } else pick = opt.gold ? "gold" : opt.reputation ? "reputation" : "none";
      if (pick === "gold") {
        p.gold -= opt.goldAmount;
        log(`任務「${def.name}」逾期，支付 ${opt.goldAmount} 金`);
      } else if (pick === "reputation") {
        const move = Math.min(Math.abs(p.reputation), RULES.expiryReputation[def.type] ?? 1);
        p.reputation -= Math.sign(p.reputation) * move;
        log(`任務「${def.name}」逾期，聲望往 0 移動 ${move}`);
      } else {
        log(`任務「${def.name}」逾期，金幣不足，金幣扣到 0`);
        p.gold = 0;
      }
      // 完全沒有嘗試過的任務：累積王國不信任（docs/spec.md 8.2.1）
      if (state.taskCards[uid]!.attempts === 0) {
        p.distrust = Math.min(RULES.distrust.max, p.distrust + 1);
        log(`沒有嘗試就讓任務逾期，王國不信任 +1（目前 ${p.distrust} 層）`);
      }
      state.taskCards[uid]!.attempts = 0;
    }
    removeTask(p, uid);
    state.taskDiscard.push(uid);
    state.pendingExpiry.shift();
  }

  for (const uid of p.staging) {
    const def = taskDef(state, lib, uid);
    p.formal.push({ uid, timer: def.type in RULES.timer ? (RULES.timer[def.type] ?? null) : 3 });
  }
  p.staging = [];
  // 4. 出售道具（道具在 M3 實作）；5. 公會升級由玩家以 upgrade 操作執行
}

// ── 回合與輪末 ──

function endTurn(state: GameState, lib: CardLibrary, rng: Rng): void {
  state.turnInRound += 1;
  if (state.turnInRound < state.players.length) {
    beginTurn(state);
    return;
  }
  roundEnd(state, lib, rng);
}

function beginTurn(state: GameState): void {
  state.phase = "guild";
  currentPlayer(state).actionsLeft = RULES.guildActions;
}

function roundEnd(state: GameState, lib: CardLibrary, rng: Rng): void {
  // 1. 輪末效果（M3）；2. 所有冒險者重置
  for (const p of state.players) for (const uid of p.adventurers) state.adventurerCards[uid]!.tapped = false;
  // 3. 衍生物銷毀、4. 本輪效果結束（M3）

  // 5. 公告欄全部換新
  for (const uid of state.board) if (uid) state.taskDiscard.push(uid);
  state.board = Array.from({ length: RULES.boardSize }, () => state.taskDeck.shift() ?? null);

  // 6. 酒館：最前端 2 名移到棄置區，其餘往前補，再補滿
  state.adventurerDiscard.push(...state.tavern.splice(0, RULES.tavernDropPerRound));
  while (state.tavern.length < RULES.tavernSize && state.adventurerDeck.length) state.tavern.push(state.adventurerDeck.shift()!);

  state.log.push({ round: state.round, player: null, text: `第 ${state.round} 輪結束` });

  // 7. 最後一輪：終局
  const rounds = state.config.rounds ?? RULES.rounds;
  if (state.round >= rounds) {
    state.phase = "gameOver";
    state.result = scoreGame(state, lib);
    return;
  }
  // 8. 起始玩家輪替
  state.round += 1;
  state.startPlayer = (state.startPlayer + 1) % state.players.length;
  state.turnInRound = 0;
  beginTurn(state);
  void rng;
}

export { currentPlayerIndex };
