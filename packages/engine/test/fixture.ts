import { CardLibrary, type AdventurerDef, type CardSource, type HonorDef, type TaskDef } from "../src/defs.js";
import { createGame } from "../src/setup.js";
import type { GameConfig, GameState } from "../src/state.js";

export const adv = (id: string, baseDice: number, salary: number, extra: Partial<AdventurerDef> = {}): AdventurerDef => ({
  id, name: `冒險者${id}`, race: "人類", profession: "士兵", traits: [], baseDice, salary, status: "實裝", ...extra,
});

export const task = (id: string, type: string, condition: TaskDef["condition"], gold: number, reputation = 0, extra: Partial<TaskDef> = {}): TaskDef => ({
  id, name: `任務${id}`, type, condition, tags: [], gold, reputation, status: "實裝", ...extra,
});

const ROUTES = ["財富", "財富", "聲望", "聲望", "任務", "任務", "任務", "任務", "任務", "任務", "任務", "任務", "任務", "任務", "任務", "人才", "人才", "人才", "人才", "人才", "人才"];
export const honors: HonorDef[] = ROUTES.map((route, i) => ({
  id: `H${String(i + 1).padStart(2, "0")}`, name: `榮譽${i + 1}`, route, kind: "排名型", status: "實裝",
}));

/** 預設卡池：20 名冒險者（骰數 1～3、薪資 1～2）、各類任務。 */
export function source(overrides: Partial<CardSource> = {}): CardSource {
  return {
    adventurers: Array.from({ length: 20 }, (_, i) => adv(`C${i + 1}`, (i % 3) + 1, (i % 2) + 1)),
    tasks: [
      ...Array.from({ length: 30 }, (_, i) => task(`M${i + 1}`, "一般", { op: "atLeast", x: 5 }, 4, 1)),
      task("U1", "緊急", { op: "atLeast", x: 5 }, 4),
      task("P1", "永久", { op: "atLeast", x: 1 }, 2),
      task("E1", "史詩", { op: "atLeast", x: 25 }, 20, 10),
    ],
    honors,
    ...overrides,
  };
}

export const players = ["A", "B", "C", "D"].map((id) => ({ id, name: `玩家${id}` }));

export function config(extra: Partial<GameConfig> = {}): GameConfig {
  return { seed: 1, players, honorMode: "selection", honorDraw: "balanced", includeEpic: false, includeTest: false, ...extra };
}

export function setup(extra: Partial<GameConfig> = {}, src: CardSource = source()): { state: GameState; lib: CardLibrary } {
  const cfg = config(extra);
  return { state: createGame(cfg, src), lib: new CardLibrary(src, cfg.includeTest) };
}
