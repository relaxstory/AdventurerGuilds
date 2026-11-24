/**
 * 用 AI 玩家跑多局模擬，統計整體數據。
 * 用法：npm run sim -- [局數] [榮譽模式 selection|assignment|competition]
 * 卡片資料使用最新發布的版本（含「測試」狀態的卡片）。
 * 注意：AI 策略很單純，數據反映的是規則能否運作，不等於真實玩家的平衡。
 */
import { readFileSync } from "node:fs";
import { simulate, type HonorMode } from "../packages/engine/src/index.js";

const games = Number(process.argv[2] ?? 200);
const honorMode = (process.argv[3] ?? "selection") as HonorMode;
const index = JSON.parse(readFileSync("data/versions/index.json", "utf-8"));
const { cards, name } = JSON.parse(readFileSync(`data/versions/v${index.latest}.json`, "utf-8"));
const players = ["A", "B", "C", "D"].map((id) => ({ id, name: id }));

let n = 0, done = 0, gold = 0, broke = 0, up = 0, distrust = 0, rep = 0, dispatches = 0, success = 0, expired = 0;
const awarded: Record<string, number> = {};
const seen: Record<string, number> = {};
for (let seed = 1; seed <= games; seed++) {
  const s = simulate({ seed, players, honorMode, honorDraw: "balanced", includeEpic: false, includeTest: true }, cards);
  for (const p of s.players) {
    n++;
    done += p.completed.length;
    gold += p.gold;
    rep += p.reputation;
    distrust += p.distrust;
    if (p.gold === 0) broke++;
    if (p.upgraded) up++;
  }
  for (const l of s.log) {
    if (l.text.startsWith("派遣")) {
      dispatches++;
      if (l.text.includes("成功")) success++;
    }
    if (l.text.includes("逾期，")) expired++;
  }
  for (const h of s.result!.honors) {
    seen[h.honorId] = (seen[h.honorId] ?? 0) + 1;
    if (h.winners.length) awarded[h.honorId] = (awarded[h.honorId] ?? 0) + 1;
  }
}
const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;
console.log(`卡片版本 ${name}，${games} 局，榮譽模式 ${honorMode}`);
console.log(`每位玩家平均：完成任務 ${(done / n).toFixed(1)}、結束金幣 ${(gold / n).toFixed(1)}、聲望 ${(rep / n).toFixed(1)}、王國不信任 ${(distrust / n).toFixed(2)}`);
console.log(`結束時金幣歸零 ${pct(broke, n)}、有升級公會 ${pct(up, n)}`);
console.log(`派遣成功率 ${pct(success, dispatches)}（共 ${dispatches} 次），每局逾期任務 ${(expired / games).toFixed(1)} 張`);
console.log("王國榮譽頒發率（有人取得／出現次數）：");
console.log(Object.keys(seen).sort().map((k) => `${k} ${pct(awarded[k] ?? 0, seen[k]!)}`).join("  "));
