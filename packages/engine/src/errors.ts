/** 玩家操作不符合規則時拋出，訊息直接顯示給玩家。 */
export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}
