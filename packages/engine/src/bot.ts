/**
 * 簡單的 AI 玩家：用來自動跑完整局、驗證規則與做平衡模擬。
 * 策略刻意保持單純，不代表最佳玩法。
 */
import { adjustOptions, clauses, dispatchLimitProblem, mustDispatch, outcome, participants, participationProblem, salaryFor } from "./abilities.js";
import { turnOptions } from "./dice.js";
import { applyAction, baseDiceOf, stagingSlots, taskDef, upgradeCost, type Action, type ExpiryPenalty } from "./actions.js";
import { RuleError } from "./errors.js";
import type { CardLibrary, CardSource } from "./defs.js";
import { CardLibrary as Library } from "./defs.js";
import { createGame } from "./setup.js";
import { currentPlayer, type GameConfig, type GameState } from "./state.js";

const value = (state: GameState, lib: CardLibrary, uid: string) => baseDiceOf(state, lib, uid) * 2 - salaryFor(state, lib, [uid]).total;

function bestTavernIndex(state: GameState, lib: CardLibrary): number {
  let best = -1;
  let bestValue = -Infinity;
  state.tavern.forEach((uid, i) => {
    const v = value(state, lib, uid);
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
  const dice = (uid: string) => baseDiceOf(state, lib, uid);
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

export function botAction(state: GameState, lib: CardLibrary): Action {
  const p = currentPlayer(state);
  switch (state.phase) {
    case "guild": {
      if (p.actionsLeft < 1) return { type: "endGuildPhase" };
      const recruitIndex = bestTavernIndex(state, lib);
      if (p.adventurers.length < 3 && recruitIndex >= 0) return { type: "recruit", tavernIndex: recruitIndex };
      if (p.staging.length < stagingSlots(p)) {
        const dice = p.adventurers.reduce((s, uid) => s + baseDiceOf(state, lib, uid), 0);
        let best = -1;
        let bestScore = 0;
        state.board.forEach((uid, i) => {
          if (!uid) return;
          const def = taskDef(state, lib, uid);
          if (!def.condition) return;
          const need = def.condition.op === "atMost" ? 1 : def.condition.x / 3.5;
          if (need > dice + 1) return;
          const score = ((def.gold ?? 0) + 2 * Math.abs(def.reputation ?? 0) + 1) / Math.max(1, need);
          if (score > bestScore) [best, bestScore] = [i, score];
        });
        if (best >= 0) return { type: "acceptTask", boardIndex: best };
      }
      if (p.adventurers.length < 5 && recruitIndex >= 0) return { type: "recruit", tavernIndex: recruitIndex };
      return { type: "endGuildPhase" };
    }
    case "adventure": {
      if (state.mission) return missionStep(state, lib);
      const tasks = [
        ...p.formal.filter((f) => f.timer !== null).sort((a, b) => a.timer! - b.timer!).map((f) => f.uid),
        ...p.staging,
        ...p.formal.filter((f) => f.timer === null).map((f) => f.uid),
      ].filter((uid) => !state.epicTried.includes(uid));
      for (const uid of tasks) {
        const party = chooseParty(state, lib, uid);
        if (party) return { type: "dispatch", task: uid, adventurers: party };
      }
      return { type: "endAdventurePhase" };
    }
    case "cleanup": {
      const pending = state.pendingExpiry[0];
      if (pending) {
        const choice: ExpiryPenalty = Math.abs(p.reputation) < 3 ? "reputation" : "gold";
        return { type: "choosePenalty", task: pending, penalty: choice };
      }
      if (!p.upgraded && upgradeCost(p) <= p.gold - 2) return { type: "upgrade" };
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
      const fallback: Action = state.phase === "guild" ? { type: "endGuildPhase" } : state.phase === "adventure" ? { type: "endAdventurePhase" } : { type: "endTurn" };
      state = applyAction(state, fallback, lib);
    }
  }
  return state;
}
