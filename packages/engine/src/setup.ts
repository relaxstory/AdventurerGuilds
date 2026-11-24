import { RULES } from "./constants.js";
import { CardLibrary, type CardSource } from "./defs.js";
import { RuleError } from "./errors.js";
import { Rng } from "./rng.js";
import type { GameConfig, GameState, PlayerState } from "./state.js";

const ROUTES = ["財富", "聲望", "任務", "人才"];

/** 依榮譽模式與抽卡方式抽出本局的王國榮譽卡（docs/spec.md 11.1）。 */
function drawHonors(rng: Rng, lib: CardLibrary, config: GameConfig): { table: string[]; assigned: string[][] } {
  const n = config.players.length;
  const pool = lib.honorPool;
  const byRoute = (route: string, from: string[]) => from.filter((id) => lib.honor(id).route === route);

  if (config.honorMode === "assignment") {
    if (pool.length < n * 3) throw new RuleError(`王國榮譽卡池只有 ${pool.length} 張，王國指派模式需要 ${n * 3} 張`);
    let left = rng.shuffle(pool);
    const assigned: string[][] = [];
    for (let p = 0; p < n; p++) {
      const hand: string[] = [];
      if (config.honorDraw === "balanced") {
        // 每位玩家的 3 張來自 3 條不同的路線
        for (const route of rng.shuffle(ROUTES)) {
          if (hand.length === 3) break;
          const pick = byRoute(route, left)[0];
          if (pick) {
            hand.push(pick);
            left = left.filter((id) => id !== pick);
          }
        }
      }
      while (hand.length < 3) hand.push(left.shift()!);
      left = left.filter((id) => !hand.includes(id));
      assigned.push(hand);
    }
    return { table: [], assigned };
  }

  const count = n * 2;
  let chosen: string[] = [];
  let left = rng.shuffle(pool);
  if (config.honorDraw === "balanced") {
    // 每條路線至少 1 張
    for (const route of ROUTES) {
      const pick = byRoute(route, left)[0];
      if (pick && chosen.length < count) {
        chosen.push(pick);
        left = left.filter((id) => id !== pick);
      }
    }
  }
  chosen = [...chosen, ...left.slice(0, count - chosen.length)];
  return { table: rng.shuffle(chosen), assigned: config.players.map(() => []) };
}

export function createGame(config: GameConfig, source: CardSource): GameState {
  if (config.players.length < 1) throw new RuleError("至少需要 1 位玩家");
  const rng = new Rng(config.seed);
  const lib = new CardLibrary(source, config.includeTest);

  // 任務牌庫：隨機 50 張；加入史詩任務時洗進下半部（docs/spec.md 10.2）
  let taskKeys = rng.sample(lib.taskPool, RULES.taskDeckSize);
  if (config.includeEpic) {
    for (const epic of lib.epicPool) {
      const lower = Math.floor(taskKeys.length / 2);
      const pos = rng.int(lower, taskKeys.length);
      taskKeys = [...taskKeys.slice(0, pos), epic, ...taskKeys.slice(pos)];
    }
  }
  const taskCards: GameState["taskCards"] = {};
  const taskDeck = taskKeys.map((defKey, i) => {
    const uid = `t${i + 1}`;
    taskCards[uid] = { uid, defKey, attempts: 0, completions: 0 };
    return uid;
  });

  // 冒險者牌庫：隨機 80 張
  const adventurerCards: GameState["adventurerCards"] = {};
  const adventurerDeck = rng.sample(lib.adventurerPool, RULES.adventurerDeckSize).map((defId, i) => {
    const uid = `a${i + 1}`;
    adventurerCards[uid] = { uid, defId, face: "front", tapped: false, tokens: {} };
    return uid;
  });

  const { table, assigned } = drawHonors(rng, lib, config);

  const players: PlayerState[] = config.players.map((p, i) => ({
    id: p.id,
    name: p.name,
    gold: RULES.startGold,
    reputation: RULES.startReputation,
    distrust: 0,
    upgraded: false,
    actionsLeft: RULES.guildActions,
    missionsThisTurn: 0,
    adventurers: [],
    staging: [],
    formal: [],
    completed: [],
    items: [],
    assignedHonors: assigned[i] ?? [],
  }));

  const board = taskDeck.splice(0, RULES.boardSize);
  const tavern = adventurerDeck.splice(0, RULES.tavernSize);

  return {
    config,
    rng: rng.snapshot(),
    round: 1,
    startPlayer: rng.int(0, players.length - 1),
    turnInRound: 0,
    phase: "guild",
    players,
    adventurerCards,
    taskCards,
    adventurerDeck,
    tavern,
    adventurerDiscard: [],
    taskDeck,
    board: [...board, ...Array<null>(RULES.boardSize - board.length).fill(null)],
    taskDiscard: [],
    honors: table,
    pending: null,
    pendingQueue: [],
    itemCards: {},
    itemSeq: 0,
    derivativeSeq: 0,
    destroyed: [],
    uniquesCreated: [],
    turnStartOpen: true,
    mission: null,
    pendingExpiry: [],
    epicTried: [],
    log: [{ round: 1, player: null, text: "遊戲開始" }],
    result: null,
  };
}
