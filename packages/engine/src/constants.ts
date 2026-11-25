/** 規則數值，出處見 docs/spec.md。 */
export const RULES = {
  rounds: 8,
  startGold: 5,
  startReputation: 0,
  guildActions: 3,
  adventurerCapacity: 5,
  itemSlots: 3,
  stagingSlots: { base: 1, upgraded: 2 },
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
  distrust: { max: 3, goldPenalty: [0, 1, 2, 3] },
} as const;
