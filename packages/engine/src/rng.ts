/**
 * 固定種子的亂數產生器。
 *
 * 同樣的種子一定產生同樣的數列，所以只要記錄種子與玩家操作，
 * 就能重播整局遊戲、重現錯誤（見 docs/digital-spec.md 6.2）。
 *
 * 演算法：mulberry32。狀態只有一個 32 位元整數，方便存檔。
 */
export interface RngState {
  readonly seed: number;
}

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** 目前的內部狀態，存檔時保存這個值即可。 */
  snapshot(): RngState {
    return { seed: this.state };
  }

  static restore(state: RngState): Rng {
    return new Rng(state.seed);
  }

  /** 0（含）到 1（不含）之間的浮點數。 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** min 到 max 之間的整數（兩端都包含）。 */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`無效的範圍：${min}～${max}`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** 擲一顆六面骰。 */
  d6(): number {
    return this.int(1, 6);
  }

  /** 擲 n 顆六面骰。n 為 0 時回傳空陣列。 */
  rollDice(n: number): number[] {
    if (!Number.isInteger(n) || n < 0) throw new RangeError(`無效的骰子數：${n}`);
    return Array.from({ length: n }, () => this.d6());
  }

  /** 洗牌（Fisher–Yates），回傳新陣列，不改動原陣列。 */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** 不重複地隨機選出 count 個；數量不足時全部回傳（打亂順序）。 */
  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, Math.max(0, count));
  }
}
