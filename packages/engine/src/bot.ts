/**
 * 簡單的 AI 玩家：用來自動跑完整局、驗證規則與做平衡模擬。
 * 策略刻意保持單純，不代表最佳玩法。
 */
import { RULES } from "./constants.js";
import { adjustOptions, canBeFired, capacityUsed, clauses, clausesOf, has, dispatchLimitProblem, squadKeyword, unitBaseDice, mustDispatch, outcome, participants, participationProblem, salaryFor } from "./abilities.js";
import { activatedSkills, activationImplemented } from "./activate.js";
import { itemDef, itemSlots, sellPrice, slottedItems } from "./items.js";
import { turnOptions } from "./dice.js";
import { adventurerCapacity, applyAction, stagingSlots, taskDef, upgradeCost, type Action, type ExpiryPenalty } from "./actions.js";
import { RuleError } from "./errors.js";
import { HONOR_RULES } from "./honors.js";
import type { CardLibrary, CardSource } from "./defs.js";
import { CardLibrary as Library } from "./defs.js";
import { createGame } from "./setup.js";
import { currentPlayer, type GameConfig, type GameState, type PlayerState, type UpgradeBonus } from "./state.js";

const value = (state: GameState, lib: CardLibrary, uid: string) => unitBaseDice(state, lib, uid) * 2 - salaryFor(state, lib, [uid]).total;

/** AI 的可調整設定（模擬比較用）。honorWeight：王國競爭模式（榮譽卡公開）時，榮譽對決策的權重，0 表示不看榮譽。 */
export const BOT_SETTINGS = { honorWeight: 3 };

const honorsVisible = (state: GameState) => BOT_SETTINGS.honorWeight > 0 && state.config.honorMode === "competition" && state.honors.length > 0;

/**
 * 王國競爭模式：評估一個變化（招募、解僱、完成任務）對自己榮譽排名的幫助。
 * 領先或接近第一名的榮譽，每一步都有價值；落後很多的榮譽幾乎不追。其他模式回傳 0。
 */
export function honorGain(state: GameState, lib: CardLibrary, p: PlayerState, mutate: (q: PlayerState) => void): number {
  if (!honorsVisible(state)) return 0;
  const ctx = { state, lib };
  const copy: PlayerState = { ...p, adventurers: [...p.adventurers], completed: [...p.completed] };
  mutate(copy);
  let gain = 0;
  for (const h of state.honors) {
    const ev = HONOR_RULES[h];
    if (!ev) continue;
    const before = ev(ctx, p);
    const after = ev(ctx, copy);
    if (after === before) continue;
    const best = Math.max(0, ...state.players.filter((x) => x.id !== p.id).map((x) => ev(ctx, x)));
    const gap = best - before;
    const weight = gap > 3 ? 0.2 : 1 / (1 + Math.max(0, gap));
    gain += Math.sign(after - before) * Math.min(Math.abs(after - before), 3) * weight;
  }
  return gain;
}

function bestTavernIndex(state: GameState, lib: CardLibrary): number {
  let best = -1;
  let bestValue = -Infinity;
  const p = currentPlayer(state);
  state.tavern.forEach((uid, i) => {
    const v = value(state, lib, uid) + BOT_SETTINGS.honorWeight * honorGain(state, lib, p, (q) => q.adventurers.push(uid));
    if (v > bestValue) [best, bestValue] = [i, v];
  });
  return best;
}

/** 為任務挑選派遣的冒險者；沒有合適的組合時回傳 null。 */
function chooseParty(state: GameState, lib: CardLibrary, taskUid: string): string[] | null {
  const p = currentPlayer(state);
  const def = taskDef(state, lib, taskUid);
  const c = def.condition;
  if (!c) return null;
  const n = state.taskCards[taskUid]!.attempts;
  const upright = p.adventurers.filter((uid) => !state.adventurerCards[uid]!.tapped);
  const dice = (uid: string) => unitBaseDice(state, lib, uid);
  const sum = (party: string[]) => party.reduce((s, uid) => s + dice(uid), 0);
  let party: string[] = [];

  if (c.op === "atMost") {
    const pick = [...upright].sort((a, b) => dice(a) - dice(b))[0];
    if (!pick || dice(pick) * 3.5 > c.x + n + 1) return null;
    party = [pick];
  } else {
    const target = c.op === "atLeast" ? c.x - n + 1 : (c.x + c.y) / 2 - 1;
    for (const uid of [...upright].filter((u) => dice(u) > 0).sort((a, b) => dice(b) - dice(a))) {
      if (sum(party) * 3.5 >= target) break;
      party.push(uid);
    }
    if (!party.length || sum(party) * 3.5 < target - 3) return null;
  }

  if (p.missionsThisTurn === 0) for (const must of mustDispatch(state, lib, p)) if (!party.includes(must)) party.push(must);
  if (participationProblem(state, lib, party) || dispatchLimitProblem(state, lib, party)) return null;
  const salary = salaryFor(state, lib, party).total;
  if (salary > p.gold) return null;
  if (salary > (def.gold ?? 0) + 2 * Math.abs(def.reputation ?? 0) + 2) return null;
  return party;
}

/** 進行中的派遣：擲骰前的選擇、擲骰後的調整。 */
function missionStep(state: GameState, lib: CardLibrary): Action {
  const m = state.mission!;
  const def = taskDef(state, lib, m.task);
  const op = def.condition!.op;
  if (m.stage === "assemble") {
    const predictions: Record<string, "odd" | "even"> = {};
    const baseDice: Record<string, number> = {};
    for (const uid of participants(m)) {
      if (clauses(state, lib, uid, "PREDICT_PARITY").length) predictions[uid] = "even";
      const range = clauses(state, lib, uid, "BASE_DICE_CHOICE")[0];
      if (range) baseDice[uid] = op === "atMost" ? Number(range.x) : Number(range.y);
    }
    return { type: "roll", predictions, baseDice };
  }
  const options = adjustOptions(state, lib, m);
  const lowest = () => m.dice.indexOf(Math.min(...m.dice));
  const highest = () => m.dice.indexOf(Math.max(...m.dice));
  const remove = options.find((o) => o.kind === "remove");
  if (remove) return { type: "adjust", adjustment: { kind: "remove", card: remove.card, die: op === "atMost" ? highest() : lowest() } };
  if (!outcome(state, lib, m).success) {
    const turn = options.find((o) => o.kind === "turn");
    if (turn) {
      const done = m.turned[turn.card] ?? [];
      const candidates = m.dice.map((d, i) => ({ d, i })).filter(({ i }) => !done.includes(i));
      const pick = op === "atMost" ? candidates.sort((a, b) => b.d - a.d)[0] : candidates.sort((a, b) => a.d - b.d)[0];
      if (pick) {
        const faces = turnOptions(pick.d);
        const face = op === "atMost" ? Math.min(...faces) : Math.max(...faces);
        if ((op === "atMost" && face < pick.d) || (op !== "atMost" && face > pick.d)) {
          return { type: "adjust", adjustment: { kind: "turn", card: turn.card, die: pick.i, face } };
        }
      }
    }
    const reroll = options.find((o) => o.kind === "reroll");
    if (reroll && m.dice.length) return { type: "adjust", adjustment: { kind: "reroll", card: reroll.card, dice: [op === "atMost" ? highest() : lowest()] } };
  }
  return { type: "resolve" };
}

/** 回應等待中的決定：能橫置就橫置價值最低的冒險者，否則選另一項。 */
function botDecision(state: GameState, lib: CardLibrary): Action {
  const pending = state.pending!;
  const who = state.players.find((x) => x.id === pending.player)!;
  if (pending.kind === "tapTarget") return { type: "decide", decision: { option: "tap", target: pending.targets[0]! } };
  if (pending.kind === "chooseItem") return { type: "decide", decision: { option: "item", name: pending.options[0]! } };
  if (pending.kind === "discardItem") {
    const cheapest = [...pending.items].sort((a, b) => sellPrice(state, lib, who, a) - sellPrice(state, lib, who, b))[0]!;
    return { type: "decide", decision: { option: "discard", target: cheapest } };
  }
  if (pending.kind === "chooseWorkshop") return { type: "decide", decision: { option: "workshop", names: pending.options.slice(0, pending.count) } };
  if (pending.kind === "resetAdventurers") return { type: "decide", decision: { option: "reset", targets: pending.candidates.slice(0, pending.count) } };
  if (pending.kind === "extendTask") return { type: "decide", decision: { option: "task", target: pending.candidates[0]! } };
  if (pending.kind === "confirmReplace") return { type: "decide", decision: { option: pending.what === "adventurer" ? "yes" : "no" } };
  if (pending.kind === "destroyOwn") {
    const pick = [...pending.candidates].sort((a, b) => Number(!!state.adventurerCards[b]!.derivative) - Number(!!state.adventurerCards[a]!.derivative) || value(state, lib, a) - value(state, lib, b))[0]!;
    return { type: "decide", decision: { option: "destroy", target: pick } };
  }
  if (pending.kind === "givePlayer") {
    const target = state.players.filter((x) => x.id !== who.id).sort((a, b) => b.reputation - a.reputation)[0]!;
    return { type: "decide", decision: { option: "player", target: target.id } };
  }
  const upright = who.adventurers.filter((u) => !state.adventurerCards[u]!.tapped).sort((a, b) => value(state, lib, a) - value(state, lib, b));
  if (upright.length) return { type: "decide", decision: { option: "tap", target: upright[0]! } };
  return { type: "decide", decision: { option: pending.kind === "tapOrPay" ? "pay" : "flip" } };
}

/** 使用單純的主動能力：只獲得資源的能力、布魯斯與里諾、凱菲在回合開始時睡覺。 */
function botActivation(state: GameState, lib: CardLibrary, timing: "start" | "end"): Action | null {
  const p = currentPlayer(state);
  const richest = state.players.filter((x) => x.id !== p.id).sort((a, b) => b.gold - a.gold)[0];
  for (const uid of p.adventurers) {
    const card = state.adventurerCards[uid]!;
    for (const [skill, clauses] of activatedSkills(state, lib, uid)) {
      if (!activationImplemented(clauses)) continue;
      const cost = clauses.find((c) => c.code === "COST")!;
      if (cost.x.includes("橫置") && card.tapped) continue;
      if (Number(cost.y || 0) > p.gold - 2) continue;
      const codes = clauses.map((c) => c.code).filter((c) => c !== "COST" && c !== "TIMING");
      const isStart = clauses.some((c) => c.code === "TIMING" && c.x === "回合開始時");
      if (timing === "start") {
        if (isStart && codes.includes("EFF_REMOVE_TOKENS_SELF") && (card.tokens["疲勞"] ?? 0) >= 4) return { type: "activate", card: uid, skill };
        continue;
      }
      if (isStart) continue;
      if (codes.every((c) => c === "EFF_GAIN")) return { type: "activate", card: uid, skill };
      if (richest && codes.length === 1 && (codes[0] === "EFF_OPPONENT_TAP_OR_PAY" || codes[0] === "EFF_OPPONENT_TAP_OR_FLIP")) {
        return { type: "activate", card: uid, skill, player: richest.id };
      }
    }
  }
  return null;
}

/** AI 每回合最多派遣次數。 */
export const BOT_MISSION_CAP = 8;

/** 冒險者型公會升級時，AI 從冒險者棄置區挑選的冒險者（價值最高的非衍生物）。 */
export function botDiscardPick(state: GameState, lib: CardLibrary): string | undefined {
  return state.adventurerDiscard
    .filter((u) => state.adventurerCards[u] && !state.adventurerCards[u]!.derivative)
    .sort((a, b) => value(state, lib, b) - value(state, lib, a))[0];
}

/** AI 的升級動作（含冒險者型公會的棄置區招募）。 */
export function botUpgrade(state: GameState, lib: CardLibrary, p: PlayerState, bonus = botUpgradeBonus(state, lib, p)): Action {
  const pick = (state.config.upgradeVariant ?? RULES.upgradeVariant) === "guildType" && bonus === "adventurer" ? botDiscardPick(state, lib) : undefined;
  return pick ? { type: "upgrade", bonus, recruit: pick } : { type: "upgrade", bonus };
}

/** AI 的升級加成選擇：冒險者已滿就加冒險者格，否則加任務暫存格。 */
export function botUpgradeBonus(state: GameState, lib: CardLibrary, p: PlayerState): UpgradeBonus {
  const full = capacityUsed(state, lib, p) >= adventurerCapacity(p);
  const variant = state.config.upgradeVariant ?? RULES.upgradeVariant;
  if (variant === "specialize") return full ? "adventurer" : "task";
  if (variant === "guildType") {
    // 道具相關能力多、或道具區已滿 → 經濟型；冒險者已滿且棄置區有好人選 → 冒險者型；否則任務型
    const itemSkills = p.adventurers.filter((u) => clausesOf(state, lib, u).some((c) => /ITEM|SELL_PRICE/.test(c.code))).length;
    if (itemSkills >= 2 || slottedItems(state, lib, p).length >= itemSlots(state, lib, p)) return "economy";
    const pick = botDiscardPick(state, lib);
    const weakest = Math.min(...p.adventurers.map((u) => value(state, lib, u)));
    if (honorsVisible(state)) {
      // 榮譽公開：依本局榮譽卡的路線決定專精（人才→冒險者型、任務→任務型、道具能力多→經濟型）
      const routes = state.honors.map((h) => lib.honor(h).route);
      const score = {
        task: routes.filter((r) => r === "任務").length + 1,
        adventurer: routes.filter((r) => r === "人才").length + (full ? 1 : 0) + (pick ? 0.5 : 0),
        economy: itemSkills + routes.filter((r) => r === "財富").length * 0.5,
      };
      return (Object.entries(score).sort((a, b) => b[1] - a[1])[0]![0]) as UpgradeBonus;
    }
    if (full && pick && value(state, lib, pick) >= weakest) return "adventurer";
    return "task";
  }
  return full ? "adventurer" : "staging";
}

export function botAction(state: GameState, lib: CardLibrary): Action {
  if (state.pending) return botDecision(state, lib);
  const p = currentPlayer(state);
  switch (state.phase) {
    case "guild": {
      if (state.turnStartOpen) {
        const sleep = botActivation(state, lib, "start");
        if (sleep) return sleep;
      }
      if (p.actionsLeft < 1) return { type: "endGuildPhase" };
      const recruitIndex = bestTavernIndex(state, lib);
      // 新兵：加入現有小隊的最下方（不佔容量）
      for (const [i, uid] of state.tavern.entries()) {
        const kw = squadKeyword(state, lib, uid);
        const target = kw && p.adventurers.find((u) => squadKeyword(state, lib, u) === kw);
        if (target) return { type: "recruit", tavernIndex: i, squad: { target, position: "bottom" } };
      }
      // 開局策略：先招募 2 名，再接任務，剩下的行動繼續招募（保留接任務的行動）
      if (p.adventurers.length < 2 && recruitIndex >= 0 && (p.staging.length >= stagingSlots(p) || p.actionsLeft > 1)) {
        return { type: "recruit", tavernIndex: recruitIndex };
      }
      // paid 方案：額外的暫存格要付費，留一點錢付薪資
      const stagingFee = p.upgradePerks?.paidExtra && p.staging.length >= RULES.stagingSlots.base ? p.upgradePerks.paidExtra : 0;
      if (p.staging.length < stagingSlots(p) && p.gold >= stagingFee + (stagingFee ? 2 : 0)) {
        const dice = p.adventurers.reduce((s, uid) => s + unitBaseDice(state, lib, uid), 0);
        let best = -1;
        let bestScore = 0;
        state.board.forEach((uid, i) => {
          if (!uid) return;
          const def = taskDef(state, lib, uid);
          if (!def.condition) return;
          const need = def.condition.op === "atMost" ? 1 : def.condition.x / 3.5;
          if (need > dice + 1) return;
          const honor = honorGain(state, lib, p, (q) => {
            q.completed.push(uid);
            q.gold += def.gold ?? 0;
            q.reputation += def.reputation ?? 0;
          });
          const score = ((def.gold ?? 0) + 2 * Math.abs(def.reputation ?? 0) + 1) / Math.max(1, need) + BOT_SETTINGS.honorWeight * honor;
          if (score > bestScore) [best, bestScore] = [i, score];
        });
        if (best >= 0) return { type: "acceptTask", boardIndex: best };
        if ((state.config.taskSupply ?? RULES.taskSupply) === "deckTop" && state.taskDeck.length) return { type: "acceptTask", fromDeck: true };
      }
      const used = capacityUsed(state, lib, p);
      const slotFee = p.upgradePerks?.paidExtra && !p.paidAdventurerSlot && used >= RULES.adventurerCapacity ? p.upgradePerks.paidExtra : 0;
      if (recruitIndex >= 0 && used < adventurerCapacity(p) && p.gold >= slotFee + (slotFee ? 2 : 0)) return { type: "recruit", tavernIndex: recruitIndex };
      // 冒險者已滿：酒館有明顯更好的冒險者時，解僱最弱的一名來換
      if (recruitIndex >= 0) {
        const incoming = state.tavern[recruitIndex]!;
        // 保留價值：本身價值＋解僱後對榮譽的損失
        const keep = (u: string) => value(state, lib, u) - BOT_SETTINGS.honorWeight * honorGain(state, lib, p, (q) => (q.adventurers = q.adventurers.filter((x) => x !== u)));
        const weakest = p.adventurers
          .filter((u) => !state.adventurerCards[u]!.derivative && !has(state, lib, u, "NOT_COUNT_CAPACITY") && canBeFired(state, lib, u) && !state.adventurerCards[u]!.squad?.length)
          .sort((a, b) => keep(a) - keep(b))[0];
        const candidate = weakest
          ? value(state, lib, incoming) + BOT_SETTINGS.honorWeight * honorGain(state, lib, p, (q) => (q.adventurers = [...q.adventurers.filter((x) => x !== weakest), incoming]))
          : 0;
        if (weakest && candidate >= keep(weakest) + 2) return { type: "recruit", tavernIndex: recruitIndex, replace: weakest };
      }
      return { type: "endGuildPhase" };
    }
    case "adventure": {
      if (state.mission) return missionStep(state, lib);
      const faith = p.items.filter((u) => state.itemCards[u]!.name === "火爪的信念");
      if (faith.length >= 3) return { type: "useItem", item: faith[0]! };
      // 瑪絲珂：先從工作室創造小嗶，再派遣
      for (const uid of p.adventurers) {
        const card = state.adventurerCards[uid]!;
        if (!card.tapped && card.workshop?.length && activatedSkills(state, lib, uid).has("【小嗶！出動！】")) {
          return { type: "activate", card: uid, skill: "【小嗶！出動！】", derivative: card.workshop[0]! };
        }
      }
      // 保護：避免「完成任務後重置＋可重複完成的永久任務」造成無限派遣（設計待辦 #8）
      if (p.missionsThisTurn >= BOT_MISSION_CAP) return botActivation(state, lib, "end") ?? { type: "endAdventurePhase" };
      const tasks = [
        ...p.formal.filter((f) => f.timer !== null).sort((a, b) => a.timer! - b.timer!).map((f) => f.uid),
        ...p.staging,
        ...p.formal.filter((f) => f.timer === null).map((f) => f.uid),
      ].filter((uid) => !state.epicTried.includes(uid));
      for (const uid of tasks) {
        const party = chooseParty(state, lib, uid);
        if (party) return { type: "dispatch", task: uid, adventurers: party };
      }
      return botActivation(state, lib, "end") ?? { type: "endAdventurePhase" };
    }
    case "cleanup": {
      const pending = state.pendingExpiry[0];
      if (pending) {
        const choice: ExpiryPenalty = Math.abs(p.reputation) < 3 ? "reputation" : "gold";
        return { type: "choosePenalty", task: pending, penalty: choice };
      }
      // 出售可以賣錢的道具（藥劑、炸藥、家書這類有效果的道具保留）
      const sellable = p.items.find((u) => {
        const def = itemDef(state, lib, u);
        return !def.categories.includes("[狀態]") && lib.clauses(def).length === 0 && sellPrice(state, lib, p, u) > 0;
      });
      if (sellable) return { type: "sell", item: sellable };
      if (!p.upgraded && upgradeCost(p) <= p.gold - 2) return botUpgrade(state, lib, p);
      return { type: "endTurn" };
    }
    case "gameOver":
      throw new Error("遊戲已經結束");
  }
}

/** 由 AI 玩家自動進行整局遊戲。 */
export function simulate(config: GameConfig, source: CardSource, maxSteps = 5000): GameState {
  const lib = new Library(source, config.includeTest);
  let state = createGame(config, source);
  for (let step = 0; state.phase !== "gameOver"; step++) {
    if (step >= maxSteps) throw new Error("模擬超過步數上限，可能卡住了");
    try {
      state = applyAction(state, botAction(state, lib), lib);
    } catch (e) {
      // AI 選了不合法的操作：直接結束目前的階段
      if (!(e instanceof RuleError)) throw e;
      if (state.pending) throw e;
      const fallback: Action = state.phase === "guild" ? { type: "endGuildPhase" } : state.phase === "adventure" ? { type: "endAdventurePhase" } : { type: "endTurn" };
      state = applyAction(state, fallback, lib);
    }
  }
  return state;
}
