/** 載入最新發布的卡片版本，附上技能子句（版本檔沒有附帶時，使用目前的子句對照表）。 */
import { readFileSync } from "node:fs";
import { parseCsv } from "../packages/cards/src/csv.js";
import type { CardSource, ClauseRow } from "../packages/engine/src/index.js";

export function loadLatest(): { name: string; source: CardSource; clausesFrom: "version" | "mapping" } {
  const index = JSON.parse(readFileSync("data/versions/index.json", "utf-8"));
  const v = JSON.parse(readFileSync(`data/versions/v${index.latest}.json`, "utf-8"));
  if (v.clauses) return { name: v.name, source: { ...v.cards, clauses: v.clauses }, clausesFrom: "version" };
  const [, ...rows] = parseCsv(readFileSync("data/skill-mapping.csv", "utf-8"));
  const clauses: ClauseRow[] = rows
    .filter((r) => r.length > 5)
    .map(([cardId = "", cardName = "", order = "", skillName = "", clause = "", code = "", x = "", y = "", z = ""]) => ({
      cardId: cardId === "（無編號）" ? "" : cardId, cardName, order, skillName, clause, code, x, y, z,
    }));
  return { name: v.name, source: { ...v.cards, clauses }, clausesFrom: "mapping" };
}
