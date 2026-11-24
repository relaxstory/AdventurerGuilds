/**
 * 產生能力實作進度表 docs/ability-status.md：
 * 每張卡的技能子句對應的模板是否已在規則引擎中實作。
 * 用法：npm run abilities
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseCsv } from "../packages/cards/src/csv.js";
import { IMPLEMENTED } from "../packages/engine/src/abilities.js";

const templates = JSON.parse(readFileSync("data/skill-templates.json", "utf-8")) as { code: string; name: string; type: string }[];
const [, ...rows] = parseCsv(readFileSync("data/skill-mapping.csv", "utf-8"));
const index = JSON.parse(readFileSync("data/versions/index.json", "utf-8"));
const { cards } = JSON.parse(readFileSync(`data/versions/v${index.latest}.json`, "utf-8"));

const active = new Set<string>();
for (const kind of ["adventurers", "derivatives", "items", "tasks"]) {
  for (const c of cards[kind] as { id: string; name: string; status: string; type?: string }[]) {
    if ((c.status === "實裝" || c.status === "測試") && !(c.type ?? "").startsWith("史詩")) active.add(`${c.id || "（無編號）"}｜${c.name}`);
  }
}
// 已排除的子句：COST、TIMING 是主動能力的一部分，隨主動能力一起實作
const structural = new Set(["COST", "TIMING", "ITEM_CONSUME"]);
const byCard = new Map<string, { name: string; skills: Map<string, string[]> }>();
for (const [id = "", name = "", , skill = "", , code = ""] of rows.filter((r) => r.length > 5)) {
  const key = `${id}｜${name}`;
  if (!active.has(key)) continue;
  const card = byCard.get(key) ?? { name, skills: new Map() };
  card.skills.set(skill, [...(card.skills.get(skill) ?? []), code]);
  byCard.set(key, card);
}
const skillDone = (codes: string[]) => {
  const real = codes.filter((c) => !structural.has(c));
  return real.length > 0 && real.every((c) => IMPLEMENTED.has(c)) && !codes.some((c) => structural.has(c));
};
let cardsDone = 0;
let skillsDone = 0;
let skillsTotal = 0;
const lines: string[] = [];
for (const [key, card] of [...byCard].sort((a, b) => a[0].localeCompare(b[0]))) {
  const parts = [...card.skills].map(([skill, codes]) => {
    skillsTotal++;
    const ok = skillDone(codes);
    if (ok) skillsDone++;
    return `${ok ? "✅" : "⬜"} ${skill}`;
  });
  const all = [...card.skills.values()].every(skillDone);
  if (all) cardsDone++;
  lines.push(`| ${key.split("｜")[0]} | ${card.name} | ${all ? "✅" : "⬜"} | ${parts.join("<br>")} |`);
}
const used = new Set(rows.map((r) => r[5]));
const tplDone = templates.filter((t) => used.has(t.code) && IMPLEMENTED.has(t.code)).length;
const tplTotal = templates.filter((t) => used.has(t.code) && !structural.has(t.code)).length;
const out = [
  "# 能力實作進度",
  "",
  "> 由 `npm run abilities` 產生，請勿直接編輯。",
  "> ✅ 已在規則引擎中實作，可以在測試模式中正常運作；⬜ 尚未實作，試玩時這個技能不會有效果。",
  "> 史詩任務暫時排除，不列入。",
  "",
  `- 技能模板：${tplDone} / ${tplTotal}`,
  `- 技能：${skillsDone} / ${skillsTotal}`,
  `- 所有技能都已實作的卡片：${cardsDone} / ${byCard.size}`,
  "",
  "| 編號 | 卡片 | 完成 | 技能 |",
  "|---|---|---|---|",
  ...lines,
  "",
].join("\n");
writeFileSync("docs/ability-status.md", out);
console.log(`技能模板 ${tplDone}/${tplTotal}、技能 ${skillsDone}/${skillsTotal}、完整的卡片 ${cardsDone}/${byCard.size}`);
