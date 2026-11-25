/** 內部版本號：規則或架構調整時才升版，紀錄見 docs/versions.md。 */
export const GAME_VERSION = "alpha1.2";

/** 規則數值，出處見 docs/spec.md。 */
export const RULES = {
  rounds: 8,
  startGold: 5,
  startReputation: 0,
  guildActions: 3,
  adventurerCapacity: 5,
  itemSlots: 3,
  stagingSlots: { base: 1 },
  /** 二階公會升級方案（docs/spec.md 8.4）。 */
  upgradeVariant: "choice" as "choice" | "adventurer2" | "specialize" | "paid",
  /** paid 方案：使用額外格子時支付的金幣。 */
  upgradePaidCost: 2,
  boardSize: 5,
  tavernSize: 5,
  tavernDropPerRound: 2,
  taskDeckSize: 50,
  adventurerDeckSize: 80,
  /** 任務移入正式任務區時的時限；null 表示 [∞]。 */
  timer: { 一般: 3, 緊急: 1, 永久: null, 史詩: 3 } as Record<string, number | null>,
  /** 逾期懲罰 B：聲望往 0 移動的量。 */
  expiryReputation: { 一般: 1, 緊急: 2 } as Record<string, number>,
  upgrade: { freeAtCompleted: 4, discountReputation: 5, discountCost: 3, cost: 7 },
  /** 輪末補助：金幣少於此數的玩家補到此數（最後一輪不執行）。 */
  roundEndGoldFloor: 3,
  /** 任務供應方式：deckTop＝可以從公告欄或任務牌庫頂拿取（docs/spec.md 6.3）。 */
  taskSupply: "deckTop" as "board" | "deckTop" | "refill",
  distrust: { max: 3, goldPenalty: [0, 1, 2, 3] },
} as const;
