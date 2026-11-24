import { raceOf } from "./abilities.js";
import type { CardLibrary, TaskDef } from "./defs.js";
import type { GameResult, GameState, HonorResult, PlayerState } from "./state.js";

/**
 * 王國榮譽的評選方式（docs/honor-cards.md）。
 * 回傳每位玩家的數值，數值最高者取得；數值必須大於 0，同分都拿到。
 * 「最低」類的榮譽（暗影之主）以負號轉成「最高」。
 */
type Evaluator = (ctx: Ctx, p: PlayerState) => number;

interface Ctx {
  readonly state: GameState;
  readonly lib: CardLibrary;
}

const completedDefs = (ctx: Ctx, p: PlayerState): TaskDef[] =>
  p.completed.map((uid) => ctx.lib.task(ctx.state.taskCards[uid]!.defKey));

const faces = (ctx: Ctx, p: PlayerState) =>
  p.adventurers.map((uid) => {
    const c = ctx.state.adventurerCards[uid]!;
    return ctx.lib.adventurer(c.face === "back" ? `${c.defId}B` : c.defId);
  });

const count = <T>(items: readonly T[], pred: (t: T) => boolean) => items.filter(pred).length;
const maxGroup = (values: readonly string[]) => {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return Math.max(0, ...m.values());
};
const stripB = (s: string) => s.replace(/\(B\)$/, "");

export const HONOR_RULES: Record<string, Evaluator> = {
  H01: (_, p) => p.gold, // 富甲一方
  H02: (ctx, p) => faces(ctx, p).reduce((s, a) => s + (a.salary ?? 0), 0), // 重金禮聘
  H03: (_, p) => p.reputation, // 王國之光（須大於 0）
  H04: (_, p) => -p.reputation, // 暗影之主（聲望須小於 0）
  H05: (_, p) => p.completed.length, // 使命必達（任務完成區，不含永久任務）
  H06: (ctx, p) => count(completedDefs(ctx, p), (t) => t.type === "緊急"), // 分秒必爭
  H07: (ctx, p) =>
    [...p.formal.map((f) => f.uid), ...p.staging].reduce((s, uid) => s + ctx.state.taskCards[uid]!.completions, 0), // 持之以恆
  H08: (ctx, p) => count(completedDefs(ctx, p), (t) => t.condition?.op === "between"), // 恰到好處
  H09: (ctx, p) => count(completedDefs(ctx, p), (t) => t.condition?.op === "atMost"), // 輕手輕腳
  H10: (ctx, p) => Math.max(0, ...completedDefs(ctx, p).map((t) => (t.condition?.op === "atLeast" ? t.condition.x : 0))), // 力挽狂瀾
  H11: (ctx, p) => count(completedDefs(ctx, p), (t) => t.tags.includes("[王國]")), // 王國之友
  H12: (ctx, p) => count(completedDefs(ctx, p), (t) => (t.reputation ?? 0) > 0), // 正義之師
  H13: (ctx, p) => count(completedDefs(ctx, p), (t) => (t.reputation ?? 0) < 0), // 地下交易
  H14: (ctx, p) => count(completedDefs(ctx, p), (t) => (t.reputation ?? 0) === 0), // 只為報酬
  H15: (ctx, p) => new Set(completedDefs(ctx, p).flatMap((t) => t.tags)).size, // 見多識廣
  H16: (ctx, p) => faces(ctx, p).length, // 人才濟濟（衍生物不計入，M3）
  H17: (ctx, p) => faces(ctx, p).reduce((s, a) => s + (a.baseDice ?? 0), 0), // 兵強馬壯
  H18: (ctx, p) => maxGroup(faces(ctx, p).map((a) => stripB(a.profession))), // 術業專攻
  H19: (ctx, p) => new Set(faces(ctx, p).map((a) => stripB(a.profession)).filter(Boolean)).size, // 百工百業
  H20: (ctx, p) => new Set(p.adventurers.map((uid) => raceOf(ctx.state, ctx.lib, uid)).filter(Boolean)).size, // 多元共榮（菲特視為人類）
  H21: (ctx, p) => count(faces(ctx, p), (a) => a.traits.includes("[王國]")), // 王國棟樑
};

function evaluate(ctx: Ctx, honorId: string): { values: Record<string, number>; best: number } {
  const rule = HONOR_RULES[honorId];
  if (!rule) throw new Error(`王國榮譽 ${honorId} 沒有評選方式`);
  const values: Record<string, number> = {};
  for (const p of ctx.state.players) values[p.id] = rule(ctx, p);
  return { values, best: Math.max(...Object.values(values)) };
}

/** 終局計分（docs/spec.md 11.4）。 */
export function scoreGame(state: GameState, lib: CardLibrary): GameResult {
  const ctx = { state, lib };
  const honors: HonorResult[] = [];
  if (state.config.honorMode === "assignment") {
    // 王國指派：只判定持有者本人是否為第一名（含同分）
    for (const p of state.players) {
      for (const honorId of p.assignedHonors) {
        const { values, best } = evaluate(ctx, honorId);
        const mine = values[p.id]!;
        honors.push({ honorId, values, holder: p.id, winners: mine > 0 && mine === best ? [p.id] : [] });
      }
    }
  } else {
    for (const honorId of state.honors) {
      const { values, best } = evaluate(ctx, honorId);
      honors.push({ honorId, values, winners: best > 0 ? state.players.filter((p) => values[p.id] === best).map((p) => p.id) : [] });
    }
  }
  const totals: Record<string, number> = {};
  for (const p of state.players) totals[p.id] = honors.filter((h) => h.winners.includes(p.id)).length;
  const top = Math.max(...Object.values(totals));
  return { honors, totals, winners: state.players.filter((p) => totals[p.id] === top).map((p) => p.id) };
}
