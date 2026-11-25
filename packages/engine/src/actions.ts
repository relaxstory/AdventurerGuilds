import * as ab from "./abilities.js";
import { activate, activatedSkills, decide, type ActivateParams, type Decision } from "./activate.js";
import { sellItem, useItem, type UseItemParams } from "./items.js";
import { afterSettle, checkReputationDrops, onTurnStart, roundEndDestroy } from "./lifecycle.js";
import { RULES } from "./constants.js";
import type { CardLibrary, TaskDef } from "./defs.js";
import { RuleError } from "./errors.js";
import { scoreGame } from "./honors.js";
import { Rng } from "./rng.js";
import { currentPlayer, currentPlayerIndex, type GameState, type PlayerState } from "./state.js";

export type ExpiryPenalty = "gold" | "reputation";

export type Action =
  /**
   * 公會階段：招募酒館第 tavernIndex 張（0 起算）；replace 為要解僱的冒險者。
   * squad：把招募的新兵（或整支小隊）放到自己現有小隊的最上方或最下方（docs/spec.md 12）。
   */
  | {
      readonly type: "recruit";
      readonly tavernIndex: number;
      readonly replace?: string;
      readonly squad?: { readonly target: string; readonly position: "top" | "bottom" };
    }
  /** 公會階段：接取公告欄第 boardIndex 張任務。 */
  | { readonly type: "acceptTask"; readonly boardIndex: number }
  | { readonly type: "endGuildPhase" }
  /** 冒險階段：派遣冒險者執行任務（支付薪資、橫置），進入組隊步驟。 */
  | { readonly type: "dispatch"; readonly task: string; readonly adventurers: readonly string[] }
  /** 派遣：隊伍確定，套用擲骰前的選擇，建立骰池並擲骰，進入調整步驟。 */
  | ({ readonly type: "roll" } & ab.RollChoices)
  /** 派遣：使用擲骰後的能力（重擲、轉動、移除、加注、調整結果值）。 */
  | { readonly type: "adjust"; readonly adjustment: ab.Adjustment }
  /** 派遣：調整完畢，計算結果並結算任務。 */
  | { readonly type: "resolve" }
  | { readonly type: "endAdventurePhase" }
  /** 自己的回合：發動主動能力。 */
  | ({ readonly type: "activate" } & ActivateParams)
  /** 自己的回合：使用道具。 */
  | ({ readonly type: "useItem" } & UseItemParams)
  /** 公會整理階段：出售道具。 */
  | { readonly type: "sell"; readonly item: string }
  /** 回應等待中的決定（由 state.pending.player 做出）。 */
  | { readonly type: "decide"; readonly decision: Decision }
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
  if (state.pending && action.type !== "decide") {
    const who = state.players.find((x) => x.id === state.pending!.player)!;
    throw new RuleError(`等待 ${who.name} 做決定`);
  }
  // 回合開始的時機：做了「回合開始時」能力以外的任何操作後就結束
  const turnStartAction =
    action.type === "activate" &&
    (activatedSkills(state, lib, action.card).get(action.skill) ?? []).some((c) => c.code === "TIMING" && c.x === "回合開始時");
  if (!turnStartAction) state.turnStartOpen = false;
  const reputationBefore = Object.fromEntries(state.players.map((x) => [x.id, x.reputation]));

  switch (action.type) {
    case "recruit": {
      need("guild", "公會階段");
      const uid = state.tavern[action.tavernIndex];
      if (!uid) throw new RuleError("酒館的這個位置沒有冒險者");
      const free = ab.freeRecruit(state, lib, p, uid);
      if (!free && p.actionsLeft < 1) throw new RuleError("本回合的公會行動已經用完");
      const name = adventurerFace(state, lib, uid).name;
      if (action.squad) {
        if (action.replace !== undefined) throw new RuleError("加入小隊時不需要解僱冒險者");
        const { target, position } = action.squad;
        const keyword = ab.squadKeyword(state, lib, uid);
        const targetKeyword = p.adventurers.includes(target) ? ab.squadKeyword(state, lib, target) : null;
        if (!keyword || keyword !== targetKeyword) throw new RuleError(`只有名字有「${keyword ?? "新兵"}」的冒險者能組成小隊`);
        const incoming = state.adventurerCards[uid]!;
        const existing = state.adventurerCards[target]!;
        const tapped = existing.tapped;
        if (position === "top") {
          incoming.squad = [...(incoming.squad ?? []), target, ...(existing.squad ?? [])];
          delete existing.squad;
          p.adventurers[p.adventurers.indexOf(target)] = uid;
          incoming.tapped = tapped;
        } else {
          existing.squad = [...(existing.squad ?? []), uid, ...(incoming.squad ?? [])];
          delete incoming.squad;
        }
        state.tavern.splice(action.tavernIndex, 1);
        const next = state.adventurerDeck.shift();
        if (next) state.tavern.push(next);
        const captain = position === "top" ? uid : target;
        log(`招募 ${name}，放到小隊${position === "top" ? "最上方，成為隊長" : "最下方"}（小隊共 ${ab.members(state, captain).length} 人）`);
        if (!free) p.actionsLeft -= 1;
        ab.onRecruit(state, lib, p, uid, log);
        break;
      }
      if (action.replace !== undefined) {
        const i = p.adventurers.indexOf(action.replace);
        if (i < 0) throw new RuleError("只能解僱自己公會中的冒險者");
        const fired = action.replace;
        if (!ab.canBeFired(state, lib, fired)) throw new RuleError(`${adventurerFace(state, lib, fired).name} 無法被解僱`);
        p.adventurers.splice(i, 1);
        state.adventurerCards[fired]!.tapped = false;
        // 被解僱的冒險者放進被招募者原本的位置，不從牌庫補牌（docs/spec.md 6.2）
        state.tavern[action.tavernIndex] = fired;
        log(`招募 ${name}，解僱 ${adventurerFace(state, lib, fired).name}`);
        ab.onReturnToTavern(state, lib, fired, p.id, log);
      } else {
        const counts = !ab.has(state, lib, uid, "NOT_COUNT_CAPACITY");
        if (counts && ab.capacityUsed(state, lib, p) >= RULES.adventurerCapacity) {
          throw new RuleError(`冒險者已達上限 ${RULES.adventurerCapacity} 名，請選擇要解僱的冒險者`);
        }
        // 後面的冒險者依序往前補，從牌庫翻開新冒險者放到末端
        state.tavern.splice(action.tavernIndex, 1);
        const next = state.adventurerDeck.shift();
        if (next) state.tavern.push(next);
        log(`招募 ${name}${free ? "（不需消耗公會行動）" : ""}`);
      }
      p.adventurers.push(uid);
      if (!free) p.actionsLeft -= 1;
      ab.onRecruit(state, lib, p, uid, log);
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

    case "activate": {
      activate(state, lib, rng, p, action, log);
      break;
    }

    case "useItem": {
      useItem(state, lib, p, action, log, rng);
      break;
    }

    case "sell": {
      need("cleanup", "公會整理階段");
      requireExpiriesResolved(state, lib);
      sellItem(state, lib, p, action.item, log);
      break;
    }

    case "decide": {
      decide(state, lib, action.decision, (player, text) => state.log.push({ round: state.round, player, text }), rng);
      break;
    }

    case "endGuildPhase":
      need("guild", "公會階段");
      state.phase = "adventure";
      break;

    case "dispatch": {
      need("adventure", "冒險階段");
      if (state.mission) throw new RuleError("還有進行中的派遣");
      startMission(state, lib, p, action.task, action.adventurers, log);
      // 送錯的軍令：派遣 [迅捷] 冒險者時直接完成，不擲骰
      const m = state.mission!;
      if (ab.completesDirectly(state, lib, m)) {
        ab.onParticipate(state, lib, p, m, log);
        m.stage = "adjust";
        m.autoSuccess = true;
        resolveMission(state, lib, p, m, log);
      }
      break;
    }

    case "roll": {
      const m = requireMission(state, "assemble");
      ab.applyRollChoices(state, lib, m, action);
      rollMission(state, lib, rng, p, m, log);
      break;
    }

    case "adjust": {
      const m = requireMission(state, "adjust");
      ab.applyAdjustment(state, lib, rng, m, action.adjustment, log);
      break;
    }

    case "resolve": {
      const m = requireMission(state, "adjust");
      resolveMission(state, lib, p, m, log);
      break;
    }

    case "endAdventurePhase": {
      need("adventure", "冒險階段");
      if (state.mission) throw new RuleError("還有進行中的派遣");
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
      ab.onTurnEnd(state, lib, p, log);
      endTurn(state, lib, rng);
      break;
    }
  }

  // 暴走小嗶：和瑪絲珂在同一個公會時洗回牌庫
  ab.shuffleBackCheck(state, lib, rng, (player, text) => state.log.push({ round: state.round, player, text }));
  // 聲望下降時的觸發（梅里妲的注視）
  checkReputationDrops(state, lib, reputationBefore, (player, text) => state.log.push({ round: state.round, player, text }));
  state.rng = rng.snapshot();
  return state;
}

// ── 冒險階段：派遣（docs/spec.md 7.1）──

function requireMission(state: GameState, stage: "assemble" | "adjust") {
  const m = state.mission;
  if (state.phase !== "adventure" || !m) throw new RuleError("目前沒有進行中的派遣");
  if (m.stage !== stage) throw new RuleError(stage === "assemble" ? "已經擲過骰了" : "還沒有擲骰");
  return m;
}

/** 選任務、選冒險者、支付薪資、橫置。 */
function startMission(state: GameState, lib: CardLibrary, p: PlayerState, taskUid: string, party: readonly string[], log: (text: string) => void): void {
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
  const problem = ab.participationProblem(state, lib, party) ?? ab.dispatchLimitProblem(state, lib, party);
  if (problem) throw new RuleError(problem);

  const { total: salary } = ab.salaryFor(state, lib, party);
  if (p.missionsThisTurn === 0) {
    for (const must of ab.mustDispatch(state, lib, p)) {
      const withMust = ab.salaryFor(state, lib, [...party, must]).total;
      if (!party.includes(must) && p.gold >= withMust) {
        throw new RuleError(`本回合的第一個任務必須派遣 ${adventurerFace(state, lib, must).name}`);
      }
    }
  }
  // 擲骰前支付薪資
  if (p.gold < salary) throw new RuleError(`金幣不足：薪資需要 ${salary} 金，目前只有 ${p.gold} 金`);
  p.gold -= salary;
  for (const uid of party) if (ab.tapOnDispatch(state, lib, uid, log)) state.adventurerCards[uid]!.tapped = true;
  ab.recordDispatch(state, party);
  p.missionsThisTurn += 1;
  const names = party.map((uid) => adventurerFace(state, lib, uid).name).join("、");
  log(`派遣 ${names} 執行「${def.name}」，支付薪資 ${salary} 金`);
  state.mission = {
    task: taskUid, dispatched: [...party], joined: [], salary, stage: "assemble", dice: [], pool: 0, removedBy: {},
    predictions: {}, baseDice: {}, used: {}, turned: {}, resultDelta: 0, resultTimes: 1, autoSuccess: false, gamble: null,
  };
}

/** 隊伍確定：參與時的效果、建立骰池、擲骰、擲骰後的強制效果。 */
function rollMission(state: GameState, lib: CardLibrary, rng: Rng, p: PlayerState, m: NonNullable<GameState["mission"]>, log: (text: string, dice?: number[]) => void): void {
  const def = taskDef(state, lib, m.task);
  ab.onParticipate(state, lib, p, m, log);
  m.pool = ab.dicePool(state, lib, m, def);
  m.dice = rng.rollDice(m.pool);
  log(`擲 ${m.pool} 顆骰子`, [...m.dice]);
  ab.afterRollMandatory(state, lib, m, def, log);
  m.stage = "adjust";
}

/** 計算結果值、套用難度調整、判定與結算（docs/spec.md 7.4）。 */
function resolveMission(state: GameState, lib: CardLibrary, p: PlayerState, m: NonNullable<GameState["mission"]>, log: (text: string, dice?: number[]) => void): void {
  const pending = ab.pendingMandatory(state, lib, m);
  if (pending) throw new RuleError(pending);
  const taskUid = m.task;
  const def = taskDef(state, lib, taskUid);
  const c = def.condition!;
  const card = state.taskCards[taskUid]!;
  const { faceSum, result, n, success } = ab.outcome(state, lib, m);
  const slotEntry = p.formal.find((f) => f.uid === taskUid);
  const slot = slotEntry ? slotEntry.timer : null;
  const emptyBefore = new Set([1, 2, 3].filter((t) => !p.formal.some((f) => f.timer === t && f.uid !== taskUid)));
  const isEpic = def.type === "史詩";
  if (isEpic) state.epicTried.push(taskUid);
  const condText = c.op === "atLeast" ? `≥${c.x}` : c.op === "atMost" ? `≤${c.x}` : `${c.x}～${c.y}`;
  const adjText = n ? `（難度調整 ${n}）` : "";

  if (success) {
    const penalty = RULES.distrust.goldPenalty[Math.min(p.distrust, RULES.distrust.max)] ?? 0;
    const gold = Math.max(0, (def.gold ?? 0) - penalty);
    p.gold += gold;
    p.reputation += def.reputation ?? 0;
    if (p.distrust > 0) p.distrust -= 1; // 先用目前層數扣報酬，再消除 1 層
    const how = m.autoSuccess ? (m.dice.length ? "視為成功" : "直接完成") : `結果值 ${result}，目標 ${condText}${adjText}：成功`;
    log(`「${def.name}」${how}，獲得 ${gold} 金、聲望 ${signed(def.reputation ?? 0)}`, m.dice.length ? [...m.dice] : undefined);
  } else {
    log(`「${def.name}」結果值 ${result}，目標 ${condText}${adjText}：失敗`, [...m.dice]);
  }
  ab.onSettle(state, lib, p, m, def, { success, faceSum, slot, emptyBefore, waivedBy: ab.salaryFor(state, lib, m.dispatched).waivedBy }, log);
  ab.onSettleChoices(state, lib, p, m, result, success, log);
  afterSettle(state, lib, p, m, success, log);

  if (success) {
    card.attempts = 0;
    if (def.type === "永久") {
      card.completions += 1; // 永久任務留在 [∞]，可以重複完成（docs/spec.md 7.6）
    } else {
      removeTask(p, taskUid);
      p.completed.push(taskUid);
    }
  } else if (isEpic) {
    // 史詩任務失敗：翻面結算背面效果（暫時排除），不獲得正面獎勵
    removeTask(p, taskUid);
    state.taskDiscard.push(taskUid);
  } else {
    card.attempts += 1;
    log(`「${def.name}」獲得嘗試指示物（共 ${card.attempts} 枚）`);
  }
  state.mission = null;
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
    beginTurn(state, lib);
    return;
  }
  roundEnd(state, lib, rng);
}

function beginTurn(state: GameState, lib: CardLibrary): void {
  state.phase = "guild";
  state.turnStartOpen = true;
  const p = currentPlayer(state);
  p.actionsLeft = RULES.guildActions;
  p.missionsThisTurn = 0;
  onTurnStart(state, lib, p, (text) => state.log.push({ round: state.round, player: p.id, text }));
}

function roundEnd(state: GameState, lib: CardLibrary, rng: Rng): void {
  // 1. 輪末效果（菲特的暫時翻面在此結束）
  ab.endTemporaryFlips(state, lib, (player, text) => state.log.push({ round: state.round, player, text }));
  ab.onRoundEnd(state, lib, (p, text) => state.log.push({ round: state.round, player: p.id, text }));
  // 2. 所有冒險者重置（「不會於輪末重置」的除外）
  for (const p of state.players) {
    for (const uid of p.adventurers) if (ab.resetsAtRoundEnd(state, lib, uid)) state.adventurerCards[uid]!.tapped = false;
  }
  // 3. 臨時衍生物銷毀；4. 本輪效果結束（以輪次記錄，自動失效）
  roundEndDestroy(state, lib, (player, text) => state.log.push({ round: state.round, player, text }));

  // 5. 公告欄全部換新
  for (const uid of state.board) if (uid) state.taskDiscard.push(uid);
  state.board = Array.from({ length: RULES.boardSize }, () => state.taskDeck.shift() ?? null);

  // 6. 酒館：最前端 2 名移到棄置區，其餘往前補，再補滿
  const dropped = state.tavern.splice(0, RULES.tavernDropPerRound);
  for (const uid of dropped) for (const u of ab.members(state, uid)) state.adventurerCards[u]!.tokens = {}; // 進入棄置區時移除指示物
  state.adventurerDiscard.push(...dropped);
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
  beginTurn(state, lib);
  void rng;
}

export { currentPlayerIndex };
